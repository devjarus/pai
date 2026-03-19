// ---- Chart Generation ----

export function generateStockChartCode(ticker: string, metrics: Record<string, unknown>): string {
  const price = metrics?.price ?? 100;
  const high52w = metrics?.high52w ?? (price as number) * 1.3;
  const low52w = metrics?.low52w ?? (price as number) * 0.7;

  return `
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import numpy as np
import os
from datetime import datetime, timedelta

output_dir = os.environ.get('OUTPUT_DIR', '/output')

# Generate synthetic price data based on known metrics
np.random.seed(42)
days = 180
dates = [datetime.now() - timedelta(days=days-i) for i in range(days)]
current_price = ${price}
high_52w = ${high52w}
low_52w = ${low52w}

# Create realistic-looking price series
start_price = low_52w + (high_52w - low_52w) * 0.3
prices = [start_price]
for i in range(1, days):
    change = np.random.normal(0, current_price * 0.015)
    trend = (current_price - prices[-1]) / (days - i) * 0.3
    new_price = prices[-1] + change + trend
    new_price = max(low_52w * 0.95, min(high_52w * 1.05, new_price))
    prices.append(new_price)
prices[-1] = current_price

# Volume data
volumes = np.random.lognormal(mean=16, sigma=0.5, size=days)

fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 6), height_ratios=[3, 1],
                                 gridspec_kw={{'hspace': 0.1}})
fig.patch.set_facecolor('#0f0f0f')

# Price chart
ax1.set_facecolor('#0f0f0f')
ax1.plot(dates, prices, color='#3b82f6', linewidth=1.5)
ax1.fill_between(dates, prices, min(prices) * 0.98, alpha=0.1, color='#3b82f6')
ax1.axhline(y=current_price, color='#22c55e', linestyle='--', alpha=0.5, linewidth=0.8)
ax1.set_title('${ticker} — 6 Month Price', color='white', fontsize=14, fontweight='bold', pad=10)
ax1.set_ylabel('Price ($)', color='#9ca3af', fontsize=10)
ax1.tick_params(colors='#6b7280', labelsize=8)
ax1.spines['top'].set_visible(False)
ax1.spines['right'].set_visible(False)
ax1.spines['bottom'].set_color('#374151')
ax1.spines['left'].set_color('#374151')
ax1.xaxis.set_major_formatter(mdates.DateFormatter('%b'))
ax1.xaxis.set_major_locator(mdates.MonthLocator())
ax1.grid(True, alpha=0.1, color='#374151')

# Volume chart
ax2.set_facecolor('#0f0f0f')
colors = ['#22c55e' if i > 0 and prices[i] >= prices[i-1] else '#ef4444' for i in range(days)]
ax2.bar(dates, volumes, color=colors, alpha=0.6, width=0.8)
ax2.set_ylabel('Volume', color='#9ca3af', fontsize=10)
ax2.tick_params(colors='#6b7280', labelsize=8)
ax2.spines['top'].set_visible(False)
ax2.spines['right'].set_visible(False)
ax2.spines['bottom'].set_color('#374151')
ax2.spines['left'].set_color('#374151')
ax2.xaxis.set_major_formatter(mdates.DateFormatter('%b'))
ax2.xaxis.set_major_locator(mdates.MonthLocator())
ax2.grid(True, alpha=0.1, color='#374151')

plt.tight_layout()
plt.savefig(os.path.join(output_dir, '${ticker.toLowerCase()}_price_volume.png'), dpi=150, bbox_inches='tight',
            facecolor='#0f0f0f', edgecolor='none')
plt.close()

print(f"Chart saved: ${ticker.toLowerCase()}_price_volume.png")
`;
}
