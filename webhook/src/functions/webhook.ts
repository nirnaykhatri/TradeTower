import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { dbService } from "../services/cosmos";
import { sbPublisher, TradingViewSignalMessage } from "../services/serviceBusPublisher";
import { BotInstance, TradingSignal } from "@trading-tower/shared";
import { randomUUID, timingSafeEqual } from "crypto";
import { z } from "zod";

const WebhookSchema = z.object({
    secret: z.string().min(1),
    action: z.string().min(1),
    price: z.number().optional(),
    pair: z.string().optional(),
    alertName: z.string().optional(),
}).passthrough(); // Allow unexpected fields in payload

/**
 * Normalize TradingView alert action to standard signal type
 * Maps various alert names to BUY/SELL/STRONG_BUY/STRONG_SELL
 */
function normalizeSignalType(action: string): 'BUY' | 'SELL' | 'STRONG_BUY' | 'STRONG_SELL' {
    const lowerAction = action.toLowerCase();

    // Buy signals
    if (lowerAction.includes('strong') && lowerAction.includes('buy')) return 'STRONG_BUY';
    if (lowerAction.includes('buy')) return 'BUY';

    // Sell signals
    if (lowerAction.includes('strong') && lowerAction.includes('sell')) return 'STRONG_SELL';
    if (lowerAction.includes('sell')) return 'SELL';

    // Default: treat as BUY if unrecognized
    return 'BUY';
}

export async function webhookHandler(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.log(`Webhook received: ${request.url}`);

    const userId = request.params.userId;
    const botId = request.params.botId;

    if (!userId || !botId) {
        return { status: 400, body: "Missing userId or botId in route" };
    }

    try {
        const body = await request.json();
        const validation = WebhookSchema.safeParse(body);

        if (!validation.success) {
            context.warn(`Invalid webhook payload: ${validation.error.message}`);
            return { status: 400, body: "Invalid payload structure" };
        }

        const { secret, action, ...payload } = validation.data;

        // 1. Validate Bot
        const botContainer = dbService.getContainer("Bots");
        const { resource: bot } = await botContainer.item(botId, userId).read<BotInstance>();

        if (!bot) {
            context.warn(`Bot not found: ${botId} for user ${userId}`);
            return { status: 404, body: "Bot not found" };
        }

        if (bot.status !== 'running') {
            context.warn(`Bot is not running: ${botId}`);
            return { status: 400, body: "Bot is not in running state" };
        }

        if (bot.triggerType !== 'webhook') {
            context.warn(`Bot trigger type mismatch: ${botId}`);
            return { status: 400, body: "Bot is not configured for webhook triggers" };
        }

        // 2. Validate Secret (using timingSafeEqual to prevent timing attacks)
        if (!bot.webhookSecret) {
            context.error(`Bot ${botId} has no webhook secret configured`);
            return { status: 500, body: "Bot configuration error" };
        }

        const expectedSecret = Buffer.from(bot.webhookSecret);
        const receivedSecret = Buffer.from(secret);

        if (expectedSecret.length !== receivedSecret.length || !timingSafeEqual(expectedSecret, receivedSecret)) {
            context.error(`Invalid webhook secret for bot ${botId}`);
            return { status: 401, body: "Invalid secret" };
        }

        // 3. Store Signal (Cosmos DB for history)
        const signalContainer = dbService.getContainer("Signals");
        const newSignal: TradingSignal = {
            id: randomUUID(),
            userId,
            botId,
            source: 'tradingview',
            timeframe: undefined,
            action,
            payload,
            receivedAt: new Date().toISOString(),
            processed: false
        };

        await signalContainer.items.create(newSignal);
        context.log(`Successfully stored signal ${newSignal.id} for bot ${botId} in Cosmos DB`);

        // 4. Publish to Service Bus (event-driven entry)
        try {
            // Normalize action to signal type
            const signalType = normalizeSignalType(action);
            
            // Extract metadata from payload
            const sbMessage: TradingViewSignalMessage = {
                botId,
                signal: signalType,
                source: 'TRADINGVIEW',
                pair: payload.pair || bot.config?.pair || 'UNKNOWN',
                timestamp: Date.now(),
                metadata: {
                    alertName: payload.alertName || action,
                    price: payload.price,
                    action: action,
                    signalId: newSignal.id,
                    receivedAt: newSignal.receivedAt
                }
            };

            await sbPublisher.publishSignal(sbMessage);
            context.log(`Successfully published signal to Service Bus for bot ${botId}`);

            // Mark as processed
            await signalContainer.item(newSignal.id, userId).patch([
                { op: 'set', path: '/processed', value: true }
            ]);

        } catch (sbError: unknown) {
            const sbMessage = sbError instanceof Error ? sbError.message : String(sbError);
            context.warn(`Failed to publish to Service Bus: ${sbMessage}. Signal stored in Cosmos DB for retry.`);
            // Note: Signal is still in DB for manual processing/retry if needed
        }

        return {
            status: 202,
            jsonBody: { message: "Signal received and queued", signalId: newSignal.id }
        };

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const errorCode = error instanceof Error && 'code' in error ? (error as any).code : 'UNKNOWN_ERROR';

        // Log detailed error for debugging
        context.error(`Internal error processing webhook: ${message} (code: ${errorCode})`);

        // Return 500 for server errors
        return {
            status: 500,
            jsonBody: {
                error: "Internal Server Error",
                message: "Failed to process webhook signal"
            }
        };
    }
}

app.http('TradeTowerWebhook', {
    methods: ['POST'],
    authLevel: 'function',
    route: 'webhook/{userId}/{botId}',
    handler: webhookHandler
});
