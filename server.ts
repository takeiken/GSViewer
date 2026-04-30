import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import util from "util";

const execPromise = util.promisify(exec);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Increase payload limits for large PLY uploads
  app.use(express.json({ limit: '100mb' }));

  app.post("/api/auto-tile-step1", async (req, res) => {
    try {
      const { exemplarPlyData } = req.body;
      if (!exemplarPlyData) {
        return res.status(400).json({ error: "Missing exemplarPlyData" });
      }

      const dataDir = path.join(process.cwd(), "data");
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      const exemplarPath = path.join(dataDir, "exemplar.ply");
      
      // Write base64 data to file
      const buffer = Buffer.from(exemplarPlyData, 'base64');
      fs.writeFileSync(exemplarPath, buffer);

      console.log("Running exemplar_to_tile.py...");
      const { stdout, stderr } = await execPromise(`python ./src/gswt/exemplar_to_tile.py -i ./data/exemplar.ply -o ./data/tile.ply`);
      console.log("exemplar_to_tile.py output:", stdout, stderr);

      res.json({
        message: "Output file is ready from Step 1",
        stdout,
        stderr
      });
    } catch (error) {
      console.error("Auto-tile step 1 error:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post("/api/auto-tile-step2", async (req, res) => {
    try {
      console.log("Running transform_splat_tile.py...");
      const { stdout, stderr } = await execPromise(`python ./src/gswt/transform_splat_tile.py --input ./data/tile.ply -o ./data/tile.ply`);
      console.log("transform_splat_tile.py output:", stdout, stderr);

      res.json({
        message: "Output file is ready from Step 2",
        downloadUrl: "/api/download-tile",
        stdout,
        stderr
      });
    } catch (error) {
      console.error("Auto-tile step 2 error:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get("/api/download-tile", (req, res) => {
    const tilePath = path.join(process.cwd(), "data", "tile.ply");
    if (fs.existsSync(tilePath)) {
      res.download(tilePath, "tile.ply");
    } else {
      res.status(404).send("File not found");
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
