// TODO: Add owner authentication (wallet signature) before production use
import { Router } from "express";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

const router = Router();
const DB_PATH = path.join(__dirname, "../../db/registries.json");

// --- DB helpers ---

interface CaGuide {
  name: string;
  description: string;
  issue_url: string;
  instructions: string;
}

interface Announcement {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

interface RegistryEntry {
  description: string;
  logoUrl: string;
  category: string;
  website: string;
  tags: string[];
  listed?: boolean;
  announcements: Announcement[];
  caGuides: Record<string, CaGuide>;
}

type DB = Record<string, RegistryEntry>;

function readDB(): DB {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, "{}", "utf-8");
  }
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  return JSON.parse(raw);
}

function writeDB(db: DB): void {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
}

function makeDefaultEntry(): RegistryEntry {
  return {
    description: "",
    logoUrl: "",
    category: "other",
    website: "",
    tags: [],
    listed: true,
    announcements: [],
    caGuides: {},
  };
}

// --- Routes ---

// GET /api/registries — list all listed registry addresses
router.get("/", (req, res) => {
  const db = readDB();
  const listed = Object.entries(db)
    .filter(([, entry]) => entry.listed !== false)
    .map(([addr]) => addr);
  res.json(listed);
});

// GET /api/registries/:address
router.get("/:address", (req, res) => {
  const db = readDB();
  const addr = (req.params.address as string).toLowerCase();
  const entry = db[addr];
  if (!entry) {
    res.status(404).json({ error: "Registry not found" });
    return;
  }
  res.json(entry);
});

// PUT /api/registries/:address — update metadata (auto-create if not exists)
router.put("/:address", (req, res) => {
  const db = readDB();
  const addr = (req.params.address as string).toLowerCase();

  if (!db[addr]) {
    db[addr] = makeDefaultEntry();
  }

  const entry = db[addr];
  const { description, logoUrl, category, website, tags, listed } = req.body;
  if (description !== undefined) entry.description = String(description);
  if (logoUrl !== undefined) entry.logoUrl = String(logoUrl);
  if (category !== undefined && ["dao", "defi", "corporate", "other"].includes(category)) {
    entry.category = category;
  }
  if (website !== undefined) entry.website = String(website);
  if (Array.isArray(tags)) {
    entry.tags = tags.filter((tag: unknown): tag is string => typeof tag === "string");
  }
  if (listed !== undefined) entry.listed = typeof listed === "string" ? listed.toLowerCase() === "true" : Boolean(listed);

  writeDB(db);
  res.json(db[addr]);
});

// GET /api/registries/:address/announcements
router.get("/:address/announcements", (req, res) => {
  const db = readDB();
  const addr = (req.params.address as string).toLowerCase();
  const entry = db[addr];
  if (!entry) {
    res.status(404).json({ error: "Registry not found" });
    return;
  }
  res.json(entry.announcements);
});

// POST /api/registries/:address/announcements
router.post("/:address/announcements", (req, res) => {
  const db = readDB();
  const addr = (req.params.address as string).toLowerCase();
  if (!db[addr]) {
    res.status(404).json({ error: "Registry not found" });
    return;
  }

  const { title, body } = req.body;
  if (!title || !body) {
    res.status(400).json({ error: "title and body are required" });
    return;
  }

  const announcement: Announcement = {
    id: crypto.randomUUID(),
    title,
    body,
    createdAt: new Date().toISOString(),
  };

  db[addr].announcements.push(announcement);
  writeDB(db);
  res.status(201).json(announcement);
});

// DELETE /api/registries/:address/announcements/:id
router.delete("/:address/announcements/:id", (req, res) => {
  const db = readDB();
  const addr = (req.params.address as string).toLowerCase();
  const annId = req.params.id as string;
  if (!db[addr]) {
    res.status(404).json({ error: "Registry not found" });
    return;
  }

  const idx = db[addr].announcements.findIndex((a: Announcement) => a.id === annId);
  if (idx === -1) {
    res.status(404).json({ error: "Announcement not found" });
    return;
  }

  db[addr].announcements.splice(idx, 1);
  writeDB(db);
  res.status(204).send();
});

// GET /api/registries/:address/ca-guides
router.get("/:address/ca-guides", (req, res) => {
  const db = readDB();
  const addr = (req.params.address as string).toLowerCase();
  const entry = db[addr];
  if (!entry) {
    res.status(404).json({ error: "Registry not found" });
    return;
  }
  res.json(entry.caGuides);
});

// PUT /api/registries/:address/ca-guides/:caHash
router.put("/:address/ca-guides/:caHash", (req, res) => {
  const db = readDB();
  const addr = (req.params.address as string).toLowerCase();
  const caHash = req.params.caHash as string;
  if (!db[addr]) {
    res.status(404).json({ error: "Registry not found" });
    return;
  }

  const { name, description, issue_url, instructions } = req.body;
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  db[addr].caGuides[caHash] = {
    name,
    description: description || "",
    issue_url: issue_url || "",
    instructions: instructions || "",
  };

  writeDB(db);
  res.json(db[addr].caGuides[caHash]);
});

// DELETE /api/registries/:address/ca-guides/:caHash
router.delete("/:address/ca-guides/:caHash", (req, res) => {
  const db = readDB();
  const addr = (req.params.address as string).toLowerCase();
  const caHash = req.params.caHash as string;
  if (!db[addr]) {
    res.status(404).json({ error: "Registry not found" });
    return;
  }

  if (!db[addr].caGuides[caHash]) {
    res.status(404).json({ error: "CA guide not found" });
    return;
  }

  delete db[addr].caGuides[caHash];
  writeDB(db);
  res.status(204).send();
});

export default router;
