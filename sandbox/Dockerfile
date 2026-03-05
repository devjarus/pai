# Stage 1: Build Pinchtab from source with --no-sandbox patch
FROM golang:1.25 AS pinchtab-builder
WORKDIR /src
RUN git clone --depth 1 https://github.com/pinchtab/pinchtab.git .
# Add chromedp.NoSandbox to Chrome launch options (required in containers that drop capabilities)
RUN sed -i '/chromedp.NoFirstRun,/a \\t\tchromedp.NoSandbox,' cmd/pinchtab/main.go
RUN cd cmd/pinchtab && go build -o /go/bin/pinchtab .

# Stage 2: Runtime image with code executor + browser automation
FROM python:3.12-slim

# Data science / charting packages
RUN pip install --no-cache-dir \
    matplotlib \
    pandas \
    numpy \
    plotly \
    kaleido \
    yfinance \
    requests

# Node.js for JavaScript execution
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

# Chromium + dependencies for browser automation
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    chromium \
    libgbm1 \
    libnss3 \
    libxss1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    fonts-liberation \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Copy Pinchtab binary from builder stage
COPY --from=pinchtab-builder /go/bin/pinchtab /usr/local/bin/pinchtab

# Configure Pinchtab: Chromium path, bind to all interfaces, headless, auto-launch
ENV CHROME_PATH=/usr/bin/chromium
ENV PINCHTAB_BIND=0.0.0.0
ENV PINCHTAB_HEADLESS=true
ENV PINCHTAB_AUTO_LAUNCH=1

# Create non-root user for execution
RUN useradd -m -s /bin/bash -u 1000 sandbox

WORKDIR /app
COPY entrypoint.py /app/entrypoint.py
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Entrypoint runs as root to bind port, but code executes as sandbox user
# (see SAFE_ENV and work_dir permissions in entrypoint.py)
USER sandbox

EXPOSE 8888 9867

CMD ["/app/start.sh"]
