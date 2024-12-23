# Verwende ein offizielles Node.js-Image als Basis (Node.js LTS Version)
FROM node:23-alpine3.21

# Setze das Arbeitsverzeichnis im Container
WORKDIR /app

# Kopiere die package.json und package-lock.json (falls vorhanden)
COPY package*.json ./

# Installiere die Abhängigkeiten
RUN npm install

# Kopiere den gesamten Projektinhalt in den Container
COPY . .

# Stelle sicher, dass ENV-Dateien im Container verfügbar sind (falls `.env` gebraucht wird)
COPY .env /app/.env

RUN apk update && \
    apk upgrade && \
    apk add xvfb chromium


# Exponiere den Port (entspricht deinem PORT in der .env-Datei oder dem Standard 3000)
EXPOSE 3000

# Definiere den Startbefehl für den Container
CMD ["node", "server.js"]