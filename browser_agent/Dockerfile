# ShareTeacher browser_agent sidecar.
# browser-use 0.13 is CDP-only (no Playwright/Chromium), so the image stays slim
# — it never launches a browser, it attaches to the remote Kernel CDP url.
FROM python:3.11-slim

WORKDIR /app

# Minimal build deps for any wheels that need compiling; removed after install.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && apt-get purge -y build-essential && apt-get autoremove -y

COPY main.py ./

EXPOSE 8700

# Bind 0.0.0.0 inside the container; the host reaches it via the mapped port.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8700"]
