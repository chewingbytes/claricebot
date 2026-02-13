export async function analyzeImage(openai, image, index = 0) {
  const base64 = image.buffer.toString("base64");
  const imageUrl = `data:${image.mimetype};base64,${base64}`;

  const response = await openai.responses.create({
    model: "gpt-5-mini",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "Provide a detailed summary of this image. Focus on visible text, UI elements, and any actionable context."
          },
          {
            type: "input_image",
            image_url: imageUrl
          }
        ]
      }
    ]
  });

  const summary = response.output_text || "";
  return summary.length > 0 ? `Image ${index + 1}: ${summary}` : "";
}

export async function analyzeText(openai, inputText, imageSummaries) {
  const summariesText = imageSummaries.filter(Boolean).join("\n");

  const response = await openai.responses.create({
    model: "gpt-5-mini",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "You are given user input text and detailed image summaries. Provide a helpful response based on all information."
          },
          {
            type: "input_text",
            text: `User input text:\n${inputText || ""}`
          },
          {
            type: "input_text",
            text: `Image summaries:\n${summariesText || "(none)"}`
          }
        ]
      }
    ]
  });

  return response.output_text || "";
}
