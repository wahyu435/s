const { default: makeWASocket, useSingleFileAuthState } = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const { format } = require("date-fns");
const { Parser } = require("json2csv");

const authFile = "./auth_info.json";
if (!fs.existsSync(authFile)) fs.writeFileSync(authFile, "{}");

const { state, saveState } = useSingleFileAuthState(authFile);
const db = new sqlite3.Database("./stock.db", (err) => {
    if (err) console.error(err.message);
    console.log("Connected to the stock database.");
});

// Buat tabel jika belum ada (diperbaiki sintaksnya)
db.run(
    "CREATE TABLE IF NOT EXISTS items (" +
    "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
    "name TEXT NOT NULL, " +
    "stock INTEGER NOT NULL DEFAULT 0, " +
    "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP" +
    ")"
);

async function connectToWhatsApp() {
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
    });

    sock.ev.on("creds.update", saveState);
    sock.ev.on("connection.update", ({ connection }) => {
        if (connection === "close") {
            console.log("Connection closed, reconnecting...");
            connectToWhatsApp();
        } else if (connection === "open") {
            console.log("WhatsApp Bot Connected!");
        }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;
        const from = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

        if (text.toLowerCase() === "cek stok") {
            db.all("SELECT name, stock FROM items", [], (err, rows) => {
                if (err) {
                    console.error(err.message);
                    sock.sendMessage(from, { text: "Terjadi kesalahan saat mengambil stok." });
                    return;
                }
                let response = "📦 Daftar Stok Barang 📦\n";
                rows.forEach(row => {
                    response += `${row.name}: ${row.stock}\n`;
                });
                sock.sendMessage(from, { text: response });
            });
        } else if (text.toLowerCase().startsWith("tambah ")) {
            let [_, name, qty] = text.split(" ");
            qty = parseInt(qty);
            if (!name || isNaN(qty)) {
                sock.sendMessage(from, { text: "Format salah! Gunakan: tambah [nama] [jumlah]" });
                return;
            }
            db.run("INSERT INTO items (name, stock) VALUES (?, ?)", [name, qty], (err) => {
                if (err) console.error(err.message);
                sock.sendMessage(from, { text: `Barang ${name} ditambahkan dengan stok ${qty}.` });
            });
        } else if (text.toLowerCase().startsWith("hapus ")) {
            let name = text.split(" ")[1];
            db.run("DELETE FROM items WHERE name = ?", [name], function (err) {
                if (err) {
                    console.error(err.message);
                    sock.sendMessage(from, { text: "Terjadi kesalahan saat menghapus barang." });
                    return;
                }
                sock.sendMessage(from, { text: `Barang ${name} telah dihapus.` });
            });
        } else if (text.toLowerCase().startsWith("export")) {
            db.all("SELECT * FROM items", [], (err, rows) => {
                if (err) {
                    console.error(err.message);
                    sock.sendMessage(from, { text: "Gagal mengekspor data." });
                    return;
                }
                const fields = ["id", "name", "stock", "created_at"];
                const parser = new Parser({ fields });
                const csv = parser.parse(rows);
                fs.writeFileSync("stok.csv", csv);
                sock.sendMessage(from, { document: fs.readFileSync("stok.csv"), mimetype: "text/csv", fileName: "stok.csv" });
            });
        }
    });
}

connectToWhatsApp();
