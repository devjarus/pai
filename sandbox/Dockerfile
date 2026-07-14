# Stage 1: Build Pinchtab from source
FROM golang:1.26 AS pinchtab-builder
WORKDIR /src
RUN git clone --depth 1 https://github.com/pinchtab/pinchtab.git .
# PinchTab enables --no-sandbox when it detects /.dockerenv (or runs as root).
# We create that marker in the runtime image — no source patch required.
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

# Railway healthchecks probe $PORT. Keep it aligned with the fixed sandbox API port
# used by PAI internal networking (sandbox.railway.internal:8888).
ENV PORT=8888

# PinchTab only adds --no-sandbox for non-root processes when /.dockerenv exists.
# Docker creates this automatically; Railway/containerd often does not — without it
# Chrome crashes immediately and the sandbox service fails to deploy.
RUN touch /.dockerenv

# Create non-root user for execution
RUN useradd -m -s /bin/bash -u 1000 sandbox

WORKDIR /app
COPY sandbox/entrypoint.py /app/entrypoint.py
COPY sandbox/start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Entrypoint runs as non-root; code executes as sandbox user
# (see SAFE_ENV and work_dir permissions in entrypoint.py)
USER sandbox

EXPOSE 8888 9867

CMD ["/app/start.sh"]
