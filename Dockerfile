FROM python:3.11-slim

ENV INSTALL_DIR=/app \
    PYTHON_BIN=/usr/local/bin/python \
    PIP_BIN=/usr/local/bin/pip \
    COMMUNITY_KEEPER_ENV_FILE=/etc/community-keeper.env \
    COMMUNITY_KEEPER_RUNTIME=process \
    COMMUNITY_KEEPER_LOG_FILE=/var/log/community-keeper/run.log \
    AUTO_UPDATE=false \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    chromium \
    fonts-liberation \
    git \
    xauth \
    xvfb \
    unzip \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libu2f-udev \
    libvulkan1 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -U pip \
  && pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /var/log/community-keeper /data

EXPOSE 8765

CMD ["uvicorn", "web.app:app", "--host", "0.0.0.0", "--port", "8765"]
