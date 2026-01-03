# What is BTD Bot?
The Buy The Dip (BTD) Bot is designed to capitalize on downtrends by accumulating more of the base currency when prices drop. It allows traders to lower their average purchase cost and benefit from market rebounds.

When to Use the BTD Bot:
To increase base currency holdings during price declines.
To leverage strong downtrends with repeated bounces.
To lower the average cost of a coin by buying at lower prices.
Key Features:
Profit is calculated in base currency.
Dynamic balance changes occur as the bot executes buy and sell orders.

# Setting Up and Launching Your BTD Bot
Follow these steps to set up and activate your BTD bot:

Step 1: Select a Bot Type
Go to the Bots page and click [Start New Bot].
Select BTD Bot from the available options.
Step 2: Choose Exchange and Trading Pair
Select your exchange and a trading pair with high liquidity.
Step 3: Specify Investment Amount
Choose between base currency or quote currency for your investment.
Use the slider to set a percentage of your balance.
Step 4: Quick Setup
Select a preset configuration:

Short-term: Up to 3 days.
Mid-term: Up to 7 days.
Long-term: 25+ days.
Step 5: Backtest and Launch
Use Backtest to evaluate performance based on historical data. The feature is available for 30 days for Basic and Advanced plans, and for 365 days for Pro plan users.
Review all settings (exchange, pair, investment, profit currency, etc.).
Click [Start Bot] to activate.

# Analyzing Your BTD Bot’s Performance
Track your BTD bot’s results using the Performance Window and Bot Orders tab.

Key Metrics in the Performance Window:
Daily and Overall Profit: View accumulated gains.
Unrealized PNL: Monitor open positions.
Trading Activity: Check the number of completed transactions.
Currency Ratios: Review the balance of base and quote currencies.
Bot Orders:
History Tab: See details of completed trades, including price, amount, and profit per trade.
Open Orders Tab: Monitor active trades and remaining balances.

# Managing Your BTD Bot
Modify Active Bots:
Select your bot and click [Bot Actions] > [Modify Bot].
Adjust settings like Trailing, Take Profit, or Stop Loss.
Save changes and confirm.
Close Bots:
Select the bot and click [Stop Bot].
Choose from these options:
Convert to Base Currency: Sells quote currency to increase base currency holdings.
Convert to Quote Currency: Sells base currency at market or limit price.
Keep Currencies: Retains current balances and closes orders.
Restart Closed Bots:
Go to the History Tab.
Select the bot and click [Bot Actions] > [Restart].
Adjust settings as needed and click [Start Bot].

# Advanced BTD Bot Settings
The Bitsgap Buy-The-Dip (BTD) bot provides versatile customization options, enabling you to tailor your trading strategy to market conditions. This guide walks you through the manual adjustment settings, including configuring price levels, grid parameters, and managing risks.

Overview

Setting High and Low Prices
Adjusting Grid Step and Grid Levels
Following a Trend with Trailing Down
Managing Risks with Trailing Stop Loss
Locking in Returns with Take Profit
Watch Our Quick Video Guide: Maximizing Profits with Bitsgap's BTD Bot: Setup and Guide | Crypto Trading Series [Part 3]



Setting High and Low Prices
To customize your bot's advanced settings, click on the [Manual adjustment] button.


When you start your BTD bot, the system automatically assigns upper and lower trading range limits. These define the initial placement of sell orders (above the current price) and buy orders (below the current price).

To personalize this range, you can:

Enter specific values in the "Low Price" and "High Price" fields.
Adjust these levels directly on the chart.

Note: Modifying the price range impacts the grid step percentage while keeping the grid levels fixed. If you adjust either parameter, the last edited setting becomes fixed, with the other adapting accordingly.

Adjusting Grid Step and Grid Levels
These interconnected parameters determine your bot's trading strategy:

Grid Levels: The number of open orders placed by the bot.
Grid Step: The percentage price gap between consecutive orders.

Examples of configurations:

Wider Grid: Increase the grid step for fewer levels, yielding higher profits per trade but longer trade durations. Use in highly volatile markets.
Narrow Grid: Decrease the grid step for more levels, providing quicker trades but reduced profits per transaction. Use in flat markets.
Following a Trend with Trailing Down
The Trailing Down feature helps your bot adapt when prices drop below the grid range. It cancels upper sell orders and places new buy orders at the grid's bottom without requiring additional funds or manual adjustments.

Key Points:

Trailing Down is activated automatically but can be disabled if desired.
This feature ensures the bot keeps trading effectively during downward trends.

Managing Risks with Trailing Stop Loss
A Stop Loss (SL) limits potential losses when the price moves unfavorably.

By default, the SL is set at 3% above the top sell order but can be changed if needed.
With the Trailing SL feature, the SL level will also shift with the price range when the grid is moved by the Trailing Down feature.

When SL triggered, the bot halts trading and uses quote funds from the bot's buy orders to repurchase the base currency. The bot is then moved to the "Bot History" tab.

Locking in Returns with Take Profit
The Take Profit (TP) feature allows you to exit the market automatically when a specified profit condition is met.

Available TP Modes:

Base or Quote Currency: The bot closes when the Total PNL reaches the target percentage in either currency.
Base Currency Only: The bot sells its quote currency to lock in profits based on the base currency's Total PNL.
Quote Currency Only: The bot sells accumulated base currency to secure returns in the quote currency.

Choose the mode that aligns with your trading goals to effectively manage your exit strategy.