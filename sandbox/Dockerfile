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

# Create non-root user for execution
RUN useradd -m -s /bin/bash -u 1000 sandbox

WORKDIR /app
COPY entrypoint.py /app/entrypoint.py

# Entrypoint runs as root to bind port, but code executes as sandbox user
# (see SAFE_ENV and work_dir permissions in entrypoint.py)
USER sandbox

EXPOSE 8888

CMD ["python3", "-u", "/app/entrypoint.py"]
