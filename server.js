import express from "express";
import dotenv from "dotenv";
import { connect } from "puppeteer-real-browser";
import fetch from "node-fetch";
import fs from "fs/promises";
import FormData from "form-data";
import cron from "node-cron";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Initialisiere Cronjob-Instanz & Status
let scrapeCron = null;
let isCronRunning = false;

// Hilfsfunktion: Zufälliges Delay erzeugen
function getRandomDelay(maxSeconds = 300) { // Standardmäßig 0-300 Sekunden
    return Math.floor(Math.random() * maxSeconds * 1000); // Rückgabe: Millisekunden
}

// Scraping-Funktion
async function scrape() {
    try {
        console.log("Starte Scraping...");
        const { browser, page } = await connect({
            headless: false,
            defaultViewport: false,
        });

        await page.goto(process.env.url, { waitUntil: "networkidle2" });
        await page.type("input[id=username]", process.env.email);
        await page.click('button[type=submit]');
        await page.waitForSelector('input[id=password]');
        await page.type("input[id=password]", process.env.password);
        await page.click('button[type=submit]');
        await page.waitForSelector('button[class="bh-button bh-raised-button bh-accent-button bh-get-task-button"]', { timeout: 10000 });
        await page.click('button[class="bh-button bh-raised-button bh-accent-button bh-get-task-button"]');

        await page.waitForNetworkIdle({ timeout: 10000 });
        const tasks = await page.evaluate(() => {
            const elements = document.querySelectorAll("h2");
            const availableTasks = {};
            let currentTask = null;
            for (const element of elements) {
                if (element.tagName === "H2") {
                    currentTask = element.innerText;
                    availableTasks[currentTask] = [];
                } else if (currentTask) {
                    availableTasks[currentTask].push(element.innerText);
                }
            }
            delete availableTasks["No Current Tasks"];
            delete availableTasks["No tasks due in this period"];
            return availableTasks;
        });

        if (tasks && Object.keys(tasks).length > 0) {
            const screenshotPath = process.env.screenshotPath || "screenshot.png";
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log("Tasks gefunden:", tasks);

            const message = Object.keys(tasks).join("\n");
            if (process.env.discordWebhookId && process.env.discordWebhookToken) {
                await sendDiscordNotification(message, screenshotPath);
            }
            if (process.env.telegramTokenId && process.env.telegramChatId) {
                await sendTelegramNotification(message, screenshotPath);
            }
            await fs.unlink(screenshotPath);
            console.log("Screenshot gelöscht:", screenshotPath);
        } else {
            console.log("Keine Aufgaben gefunden.");
        }

        await browser.close();
    } catch (error) {
        console.error("Fehler im Scraping:", error);
        if (process.env.discordWebhookId && process.env.discordWebhookToken) {
            await sendDiscordNotification(error);
        }
        if (process.env.telegramTokenId && process.env.telegramChatId) {
            await sendTelegramNotification(error);
        }
    }
}

// Discord-Benachrichtigung senden
async function sendDiscordNotification(message, screenshotPath) {
    try {
        const webhookUrl = `https://discord.com/api/webhooks/${process.env.discordWebhookId}/${process.env.discordWebhookToken}`;
        const formData = new FormData();
        formData.append("content", message);
        // Überprüfe, ob screenshotPath definiert ist
        if (screenshotPath) {
            formData.append("file", await fs.readFile(screenshotPath), "screenshot.png");
        }

        const response = await fetch(webhookUrl, {
            method: "POST",
            body: formData,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Discord Webhook-Fehler: ${errorText}`);
        }
        console.log("Discord-Benachrichtigung erfolgreich gesendet.");
    } catch (error) {
        console.error("Fehler beim Discord-Versand:", error);
    }
}

// Telegram-Benachrichtigung senden
async function sendTelegramNotification(message, screenshotPath) {
    try {
        const telegramBotToken = process.env.telegramTokenId;
        const telegramChatId = process.env.telegramChatId;

        const messageResponse = await fetch(
            `https://api.telegram.org/bot${telegramBotToken}/sendMessage`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: telegramChatId,
                    text: message,
                }),
            }
        );

        if (!messageResponse.ok) {
            const errorText = await messageResponse.text();
            throw new Error(`Telegram-Fehler beim Nachrichtensenden: ${errorText}`);
        }
        console.log("Telegram-Nachricht erfolgreich gesendet.");

        const formData = new FormData();
        formData.append("chat_id", telegramChatId);
        formData.append("photo", await fs.readFile(screenshotPath), "screenshot.png");

        const photoResponse = await fetch(
            `https://api.telegram.org/bot${telegramBotToken}/sendPhoto`,
            {
                method: "POST",
                body: formData,
            }
        );

        if (!photoResponse.ok) {
            const errorText = await photoResponse.text();
            throw new Error(`Telegram-Fehler beim Foto-Senden: ${errorText}`);
        }
        console.log("Telegram-Screenshot erfolgreich gesendet.");
    } catch (error) {
        console.error("Fehler bei der Telegram-Benachrichtigung:", error);
    }
}

// API-Endpunkt: Scraping manuell auslösen
app.get("/scrape", async (req, res) => {
    console.log("Manueller Scrape-Request erhalten...");
    await scrape();
    res.send("Scraping abgeschlossen und Benachrichtigungen gesendet.");
});

// API-Endpunkt: Cronjob aktivieren
app.get("/cron/start", (req, res) => {
    if (isCronRunning) {
        return res.status(400).send("Cronjob läuft bereits.");
    }
    const cronTime = process.env.cronTime || "*/15 * * * *"
    scrapeCron = cron.schedule(cronTime, async () => {
        const delay = getRandomDelay(180); // Zufällig bis zu 180 Sekunden warten
        console.log(`Warte ${delay / 1000} Sekunden, bevor Scraping gestartet wird.`);
        setTimeout(async () => {
            console.log("Starte Scraping nach zufälligem Delay...");
            await scrape();
        }, delay);
    });

    isCronRunning = true;
    return res.send("Cronjob wurde gestartet.");
});

// API-Endpunkt: Cronjob stoppen
app.get("/cron/stop", (req, res) => {
    if (!isCronRunning) {
        return res.status(400).send("Cronjob läuft nicht.");
    }

    scrapeCron.stop();
    scrapeCron = null;
    isCronRunning = false;
    return res.send("Cronjob wurde gestoppt.");
});

// API-Endpunkt: Cronjob-Status abfragen
app.get("/cron/status", (req, res) => {
    res.json({ cronRunning: isCronRunning });
});

// Server starten
app.listen(PORT, () => {
    console.log(`Server läuft unter http://localhost:${PORT}`);
});