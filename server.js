import express from "express";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { parse } from "parse-multipart-data";
import { analyzeImage, analyzeText } from "./models.js";

dotenv.config();

const app = express();
const port = 8080;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Missing Supabase config. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY)."
  );
}

const supabase = createClient(supabaseUrl, supabaseKey);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/messages", async (req, res) => {
  const limit = Number.parseInt(req.query.limit, 10);
  const safeLimit = Number.isFinite(limit)
    ? Math.min(Math.max(limit, 1), 100)
    : 20;

  try {
    const { data, error } = await supabase
      .from("messages")
      .select("id, input_text, output_text, created_at")
      .order("created_at", { ascending: false })
      .limit(safeLimit);

    if (error) {
      throw error;
    }

    return res.json({ data: data || [] });
  } catch (error) {
    const formattedError = formatError(error);
    console.error("Messages error:", formattedError);
    return res.status(500).json({
      error: "Failed to fetch messages.",
      detail: formattedError
    });
  }
});

const multipartRaw = express.raw({
  type: "multipart/form-data",
  limit: "50mb"
});

const jsonBody = express.json({ limit: "10mb" });
const urlEncodedBody = express.urlencoded({ extended: true, limit: "10mb" });

const formatError = (error) => {
  if (!error) {
    return { message: "Unknown error" };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  if (typeof error === "object") {
    return {
      message: error.message || "Unhandled error",
      code: error.code,
      status: error.status,
      details: error.details,
      hint: error.hint,
      raw: JSON.stringify(error)
    };
  }

  return { message: String(error) };
};

app.post("/upload", multipartRaw, jsonBody, urlEncodedBody, async (req, res) => {
  const contentType = req.headers["content-type"] || "";

  let text = "";
  let images = [];

  try {
    if (contentType.includes("multipart/form-data")) {
      const boundary = contentType
        .split("boundary=")[1]
        ?.split(";")[0]
        ?.trim()
        ?.replace(/^"|"$/g, "");

      if (!boundary || !Buffer.isBuffer(req.body)) {
        return res.status(400).json({
          error: "Malformed multipart body.",
          hint: "Ensure Shortcuts sends multipart/form-data with a valid boundary."
        });
      }

      const parts = parse(req.body, boundary);

      console.log("PARTS:", parts);
      console.log(
        "PART SUMMARY:",
        parts.map((part) => ({
          name: part.name,
          filename: part.filename,
          type: part.type,
          size: part.data?.length || 0
        }))
      );
      const normalized = parts.map((part) => ({
        ...part,
        rawName: typeof part.name === "string" ? part.name : "",
        name: typeof part.name === "string" ? part.name.toLowerCase() : ""
      }));

      const reservedNames = new Set([
        "text",
        "message",
        "image",
        "images",
        "file",
        "files"
      ]);

      const extractText = (part) => {
        if (part.data && part.data.length > 0) {
          return part.data.toString("utf8").trim();
        }
        if (!part.filename && part.rawName && !reservedNames.has(part.name)) {
          return part.rawName.trim();
        }
        return "";
      };

      const isTextFile = (part) =>
        Boolean(part.filename && part.type && part.type.startsWith("text/"));

      const isImageLike = (part) =>
        Boolean(
          (part.type && part.type.startsWith("image/")) ||
            (part.type === "application/octet-stream" && part.filename) ||
            (part.filename && !isTextFile(part))
        );

      const textFieldParts = normalized.filter(
        (part) =>
          !part.filename &&
          !isImageLike(part) &&
          (part.name === "text" || part.name === "message")
      );

      const fallbackTextParts = normalized.filter(
        (part) =>
          !part.filename &&
          !isImageLike(part) &&
          (!part.name || (part.name !== "text" && part.name !== "message"))
      );

      const textFileParts = normalized.filter((part) => isTextFile(part));

      const selectedTextParts =
        textFieldParts.length > 0
          ? textFieldParts
          : textFileParts.length > 0
            ? textFileParts
            : fallbackTextParts;

      text = selectedTextParts
        .map((part) => extractText(part))
        .filter((value) => value.length > 0)
        .join("\n")
        .trim();

      const fileParts = normalized.filter((part) => isImageLike(part));

      images = fileParts.map((part) => ({
        buffer: part.data,
        mimetype: part.type || "image/jpeg"
      }));
    } else if (contentType.includes("application/json")) {
      text = req.body?.text || "";
      const imageInputs = Array.isArray(req.body?.images) ? req.body.images : [];
      images = imageInputs
        .filter((item) => typeof item === "string" && item.length > 0)
        .map((item) => {
          if (item.startsWith("data:")) {
            const [meta, base64] = item.split(",");
            const mimeMatch = meta.match(/data:(.+);base64/);
            const mimetype = mimeMatch?.[1] || "image/jpeg";
            return { buffer: Buffer.from(base64 || "", "base64"), mimetype };
          }
          return { buffer: Buffer.from(item, "base64"), mimetype: "image/jpeg" };
        });
    } else {
      text = req.body?.text || "";
    }

    if (!text && images.length === 0) {
      return res.status(400).json({ error: "No text or images provided." });
    }

    const imageSummaries = [];
    for (const [index, image] of images.entries()) {
      const summary = await analyzeImage(openai, image, index);
      if (summary) {
        imageSummaries.push(summary);
      }
    }

    console.log("summary:", imageSummaries);

    const outputText = await analyzeText(openai, text, imageSummaries);


    const { error: insertError } = await supabase.from("messages").insert({
      input_text: text,
      output_text: outputText
    });

    console.log("input_text:", text)
    console.log("outputText:", outputText)

    if (insertError) {
      throw insertError;
    }

    return res.json({ output: outputText });
  } catch (error) {
    const formattedError = formatError(error);
    console.error("Upload error:", formattedError);
    return res.status(500).json({
      error: "Processing failed.",
      detail: formattedError
    });
  }
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
