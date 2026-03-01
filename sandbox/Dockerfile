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

WORKDIR /app
COPY entrypoint.py /app/entrypoint.py

EXPOSE 8888

CMD ["python3", "/app/entrypoint.py"]
