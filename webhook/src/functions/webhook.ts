import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { dbService } from "../services/cosmos";
import { BotInstance, TradingSignal } from "../types/models";
import { randomUUID, timingSafeEqual } from "crypto";
import { z } from "zod";

const WebhookSchema = z.object({
    secret: z.string().min(1),
    action: z.string().min(1),
}).passthrough(); // Allow unexpected fields in payload

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

        // 3. Store Signal
        const signalContainer = dbService.getContainer("Signals");
        const newSignal: TradingSignal = {
            id: randomUUID(),
            userId,
            botId,
            source: 'tradingview',
            action,
            payload,
            receivedAt: new Date().toISOString(),
            processed: false
        };

        await signalContainer.items.create(newSignal);
        context.log(`Successfully ingested signal for bot ${botId}`);

        return {
            status: 202,
            jsonBody: { message: "Signal received and queued", signalId: newSignal.id }
        };

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        context.error(`Internal error processing webhook: ${message}`);
        return { status: 500, body: "Internal Server Error" };
    }
}

app.http('TradeTowerWebhook', {
    methods: ['POST'],
    authLevel: 'function',
    route: 'webhook/{userId}/{botId}',
    handler: webhookHandler
});
