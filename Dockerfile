FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PORT=8080
ENV DB_PATH=/data/rehearsal_app.db
ENV UPLOAD_FOLDER=/data/uploads
ENV ANNOUNCEMENTS_PATH=/data/announcements.json
ENV ACTIVITY_LOG_PATH=/data/activity_log.json
ENV TOKEN_TTL_HOURS=168

RUN mkdir -p /data/uploads

CMD ["gunicorn", "--bind", "0.0.0.0:8080", "server:app"]
