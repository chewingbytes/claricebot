import crypto from "crypto";
import express from "express";
import path from "path";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { parse } from "parse-multipart-data";
import { fileTypeFromBuffer } from "file-type";
import JSZip from "jszip";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import PptxGenJS from "pptxgenjs";
import { Document, HeadingLevel, Packer, Paragraph } from "docx";
import { analyzeImage, analyzeText, runClariceFlow } from "./models.js";

dotenv.config();

const app = express();
const port = 8080;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Missing Supabase config. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY).",
  );
}

const supabase = createClient(supabaseUrl, supabaseKey);
const storageBucket = process.env.STORAGE_BUCKET || "clarice";

const corsOrigin = "*";

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", corsOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  return next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const uploadToStorage = async (buffer, filename, mimetype, prefix) => {
  const extension = path.extname(filename || "");
  const safeName = filename
    ? filename.replace(/[^a-zA-Z0-9._-]/g, "_")
    : "file";
  const unique = crypto.randomUUID();
  const storagePath = `${prefix}/${unique}-${safeName || "file"}${extension}`;

  const { error } = await supabase.storage
    .from(storageBucket)
    .upload(storagePath, buffer, {
      contentType: mimetype || "application/octet-stream",
      upsert: true,
    });

  if (error) {
    throw error;
  }

  const { data } = supabase.storage
    .from(storageBucket)
    .getPublicUrl(storagePath);
  return { storagePath, publicUrl: data?.publicUrl || null };
};

const multipartRaw = express.raw({
  type: "multipart/form-data",
  limit: "50mb",
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
      stack: error.stack,
    };
  }

  if (typeof error === "object") {
    return {
      message: error.message || "Unhandled error",
      code: error.code,
      status: error.status,
      details: error.details,
      hint: error.hint,
      raw: JSON.stringify(error),
    };
  }

  return { message: String(error) };
};

const MAX_FILE_TEXT_CHARS = 20000;
const MAX_TOTAL_FILE_CHARS = 60000;

const truncateText = (text, maxChars) => {
  if (!text || text.length <= maxChars) {
    return text || "";
  }
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`;
};

const decodeXmlEntities = (value) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

const extractPptxText = async (buffer) => {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter(
      (file) => file.startsWith("ppt/slides/slide") && file.endsWith(".xml"),
    )
    .sort();

  const chunks = [];
  for (const file of slideFiles) {
    const xml = await zip.file(file).async("string");
    const matches = xml.matchAll(/<a:t[^>]*>(.*?)<\/a:t>/g);
    for (const match of matches) {
      const text = decodeXmlEntities(match[1] || "").trim();
      if (text.length > 0) {
        chunks.push(text);
      }
    }
  }

  return chunks.join("\n");
};

const extractFileText = async (file) => {
  const detected = await fileTypeFromBuffer(file.buffer);
  const extension = path.extname(file.filename || "").toLowerCase();
  const mimetype = file.mimetype || detected?.mime || "";

  if (
    mimetype.startsWith("text/") ||
    [".txt", ".md", ".csv", ".json", ".log"].includes(extension)
  ) {
    return file.buffer.toString("utf8");
  }

  if (mimetype === "application/pdf" || extension === ".pdf") {
    const pdfData = await pdfParse(file.buffer);
    return pdfData.text || "";
  }

  if (
    mimetype ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extension === ".docx"
  ) {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value || "";
  }

  if (
    mimetype ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    extension === ".pptx"
  ) {
    return extractPptxText(file.buffer, file.filename);
  }

  return "";
};

const extractFileSummaries = async (attachments) => {
  if (!attachments.length) {
    return [];
  }

  const summaries = Array(attachments.length).fill("");
  let totalChars = 0;

  for (const [index, file] of attachments.entries()) {
    try {
      const rawText = await extractFileText(file);
      const trimmed = truncateText(rawText.trim(), MAX_FILE_TEXT_CHARS);

      if (trimmed.length === 0) {
        continue;
      }

      totalChars += trimmed.length;
      if (totalChars > MAX_TOTAL_FILE_CHARS) {
        summaries[index] =
          `File ${index + 1} (${file.filename}): [truncated due to size budget]`;
        break;
      }

      summaries[index] = `File ${index + 1} (${file.filename}):\n${trimmed}`;
    } catch (error) {
      summaries[index] =
        `File ${index + 1} (${file.filename}): [failed to extract text]`;
      console.error("File extract error:", formatError(error));
    }
  }

  return summaries;
};

const parseSlides = (text) => {
  const slideRegex = /Slide\s+\d+\s*:\s*(.+)/i;
  const lines = text.split(/\r?\n/);
  const slides = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(slideRegex);
    if (match) {
      if (current) {
        slides.push(current);
      }
      current = { title: match[1].trim(), bullets: [] };
      continue;
    }
    if (!current) {
      continue;
    }
    const bullet = line.replace(/^[-*]\s+/, "").trim();
    if (bullet.length > 0) {
      current.bullets.push(bullet);
    }
  }

  if (current) {
    slides.push(current);
  }

  if (slides.length === 0) {
    return [
      { title: "Presentation", bullets: text.split(/\r?\n/).filter(Boolean) },
    ];
  }

  return slides;
};

const buildPptx = async (text) => {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  const slides = parseSlides(text);

  slides.forEach((slideData) => {
    const slide = pptx.addSlide();
    slide.addText(slideData.title || "Slide", {
      x: 0.5,
      y: 0.3,
      w: 12.3,
      h: 0.6,
      fontSize: 32,
      bold: true,
    });

    const bulletText = slideData.bullets.length
      ? slideData.bullets.map((bullet) => `• ${bullet}`).join("\n")
      : "";

    slide.addText(bulletText, {
      x: 0.7,
      y: 1.2,
      w: 12.0,
      h: 5.0,
      fontSize: 20,
      color: "363636",
    });
  });

  return pptx.write("nodebuffer");
};

const buildDocx = async (text) => {
  const lines = text.split(/\r?\n/);
  const paragraphs = [];
  for (const line of lines) {
    if (line.startsWith("## ")) {
      paragraphs.push(
        new Paragraph({
          text: line.replace(/^##\s+/, ""),
          heading: HeadingLevel.HEADING_2,
        }),
      );
      continue;
    }
    if (line.startsWith("### ")) {
      paragraphs.push(
        new Paragraph({
          text: line.replace(/^###\s+/, ""),
          heading: HeadingLevel.HEADING_3,
        }),
      );
      continue;
    }
    if (line.trim().length === 0) {
      paragraphs.push(new Paragraph(""));
      continue;
    }
    paragraphs.push(new Paragraph(line));
  }

  const doc = new Document({
    sections: [
      {
        children: paragraphs,
      },
    ],
  });

  return Packer.toBuffer(doc);
};

const generateArtifacts = async (clariceOutputs) => {
  const artifacts = [];

  for (const step of clariceOutputs) {
    if (step.model === "presentation") {
      const pptxBuffer = await buildPptx(step.output || "");
      artifacts.push({
        type: "presentation",
        filename: `presentation-${Date.now()}.pptx`,
        buffer: pptxBuffer,
        mimetype:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });
    }

    if (step.model === "report") {
      const docxBuffer = await buildDocx(step.output || "");
      artifacts.push({
        type: "report",
        filename: `report-${Date.now()}.docx`,
        buffer: docxBuffer,
        mimetype:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        content: step.output || "",
      });
    }
  }

  return artifacts;
};

app.post(
  "/upload",
  multipartRaw,
  jsonBody,
  urlEncodedBody,
  async (req, res) => {
    const contentType = req.headers["content-type"] || "";

    let text = "";
    let images = [];
    let attachments = [];

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
            hint: "Ensure Shortcuts sends multipart/form-data with a valid boundary.",
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
            size: part.data?.length || 0,
          })),
        );
        const normalized = parts.map((part) => ({
          ...part,
          rawName: typeof part.name === "string" ? part.name : "",
          name: typeof part.name === "string" ? part.name.toLowerCase() : "",
        }));

        const reservedNames = new Set([
          "text",
          "message",
          "image",
          "images",
          "file",
          "files",
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

        const textFieldParts = normalized.filter(
          (part) =>
            !part.filename && (part.name === "text" || part.name === "message")
        );

        const fallbackTextParts = normalized.filter(
          (part) =>
            !part.filename &&
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

        const imageExtensions = new Set([
          ".png",
          ".jpg",
          ".jpeg",
          ".webp",
          ".gif",
          ".bmp",
          ".tiff",
          ".heic",
          ".heif"
        ]);

        const fileParts = normalized.filter((part) => part.filename);
        const imageParts = [];
        const otherFileParts = [];

        for (const part of fileParts) {
          if (isTextFile(part)) {
            otherFileParts.push(part);
            continue;
          }

          let isImage = Boolean(part.type && part.type.startsWith("image/"));

          if (!isImage) {
            const extension = path.extname(part.filename || "").toLowerCase();
            if (imageExtensions.has(extension)) {
              isImage = true;
            }
          }

          if (!isImage) {
            const detected = await fileTypeFromBuffer(part.data);
            if (detected?.mime && detected.mime.startsWith("image/")) {
              part.type = detected.mime;
              isImage = true;
            }
          }

          if (isImage) {
            imageParts.push(part);
          } else {
            otherFileParts.push(part);
          }
        }

        images = imageParts.map((part) => ({
          buffer: part.data,
          mimetype: part.type || "image/jpeg"
        }));

        attachments = otherFileParts.map((part) => ({
          buffer: part.data,
          mimetype: part.type || "application/octet-stream",
          filename: part.filename || "file"
        }));
      } else if (contentType.includes("application/json")) {
        text = req.body?.text || "";
        const imageInputs = Array.isArray(req.body?.images)
          ? req.body.images
          : [];
        images = imageInputs
          .filter((item) => typeof item === "string" && item.length > 0)
          .map((item) => {
            if (item.startsWith("data:")) {
              const [meta, base64] = item.split(",");
              const mimeMatch = meta.match(/data:(.+);base64/);
              const mimetype = mimeMatch?.[1] || "image/jpeg";
              return { buffer: Buffer.from(base64 || "", "base64"), mimetype };
            }
            return {
              buffer: Buffer.from(item, "base64"),
              mimetype: "image/jpeg",
            };
          });
      } else {
        text = req.body?.text || "";
      }

      if (!text && images.length === 0 && attachments.length === 0) {
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

      const fileSummaries = await extractFileSummaries(attachments);

      console.log("FILE SUMMARIES:", fileSummaries);
      const clariceOutputs = await runClariceFlow(
        openai,
        text,
        imageSummaries,
        fileSummaries,
      );

      const artifacts = await generateArtifacts(clariceOutputs);

      const requestPayload = {
        input_text: text,
        image_count: images.length,
        file_count: attachments.length,
        files: attachments.map((file) => ({
          filename: file.filename,
          mimetype: file.mimetype,
          size_bytes: file.buffer?.length || 0,
        })),
      };

      const { data: requestRow, error: requestError } = await supabase
        .from("requests")
        .insert(requestPayload)
        .select("id")
        .single();

      if (requestError) {
        throw requestError;
      }

      const requestId = requestRow?.id;

      if (attachments.length > 0 && requestId) {
        const requestFiles = [];

        for (const [index, file] of attachments.entries()) {
          const upload = await uploadToStorage(
            file.buffer,
            file.filename,
            file.mimetype,
            `requests/${requestId}/uploads`,
          );

          requestFiles.push({
            request_id: requestId,
            filename: file.filename,
            mimetype: file.mimetype,
            size_bytes: file.buffer?.length || 0,
            extracted_text: fileSummaries[index] || "",
            metadata: {
              storage_path: upload.storagePath,
              storage_url: upload.publicUrl,
            },
          });
        }

        const { error: filesError } = await supabase
          .from("request_files")
          .insert(requestFiles);

        if (filesError) {
          throw filesError;
        }
      }

      if (requestId) {
        const taskRuns = clariceOutputs.map((step, index) => ({
          request_id: requestId,
          step_index: index + 1,
          model: step.model,
          goal: step.goal,
          output_text: step.output,
          iterations: step.iterations || 1,
          review_status: step.review?.status || null,
          review_issues: step.review?.issues || [],
        }));

        if (taskRuns.length > 0) {
          const { error: tasksError } = await supabase
            .from("task_runs")
            .insert(taskRuns);

          if (tasksError) {
            throw tasksError;
          }
        }

        if (artifacts.length > 0) {
          const artifactRows = [];
          for (const artifact of artifacts) {
            const upload = await uploadToStorage(
              artifact.buffer,
              artifact.filename,
              artifact.mimetype,
              `requests/${requestId}/artifacts`,
            );

            artifactRows.push({
              request_id: requestId,
              artifact_type: artifact.type,
              filename: artifact.filename,
              content_text:
                artifact.type === "report" ? artifact.content || null : null,
              storage_url: upload.publicUrl,
              metadata: {
                storage_path: upload.storagePath,
              },
            });
          }

          const { error: artifactsError } = await supabase
            .from("request_artifacts")
            .insert(artifactRows);

          if (artifactsError) {
            throw artifactsError;
          }
        }
      }

      const outputText = await analyzeText(
        openai,
        text,
        imageSummaries,
        fileSummaries,
      );

      const { error: insertError } = await supabase.from("messages").insert({
        input_text: text,
        output_text: outputText,
      });

      console.log("input_text:", text);
      console.log("outputText:", outputText);

      if (insertError) {
        throw insertError;
      }

      return res.json({
        output: outputText,
        steps: clariceOutputs,
        artifacts: artifacts.map((artifact) => ({
          type: artifact.type,
          filename: artifact.filename,
        })),
        request_id: requestRow?.id || null,
      });
    } catch (error) {
      const formattedError = formatError(error);
      console.error("Upload error:", formattedError);
      return res.status(500).json({
        error: "Processing failed.",
        detail: formattedError,
      });
    }
  },
);

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
