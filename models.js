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
              "You are an image processer. You will receive one or more images in a grid for easier viewing. Provide detailed summaries of each images."
          },
          {
            type: "input_image",
            image_url: imageUrl
          },
        ]
      }
    ]
  });

  const summary = response.output_text || "";
  return summary.length > 0 ? `Image ${index + 1}: ${summary}` : "";
}

export async function analyzeText(
  openai,
  inputText,
  imageSummaries,
  fileSummaries = []
) {
  const summariesText = imageSummaries.filter(Boolean).join("\n");
  const fileText = fileSummaries.filter(Boolean).join("\n");

  const response = await openai.responses.create({
    model: "gpt-5-mini",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "You are given user input text and detailed analysis of the user's phone screen. Provide a helpful response based on all information."
          },
          {
            type: "input_text",
            text: `User input text:\n${inputText || ""}`
          },
          {
            type: "input_text",
            text: `Image summaries:\n${summariesText || "(none)"}`
          },
          {
            type: "input_text",
            text: `File summaries:\n${fileText || "(none)"}`
          }
        ]
      }
    ]
  });

  return response.output_text || "";
}

const taskPrompts = {
  general:
    "You are a capable assistant. Provide a clear, actionable response, include steps when helpful, and ask concise follow-up questions if needed.",
  presentation:
    "Return slide content in this exact format:\nSlide 1: Title\n- bullet\n- bullet\nSlide 2: Title\n- bullet\nKeep 5-8 slides unless the request requires more.",
  report:
    "Write a structured report using Markdown headings (## Section). Include an executive summary, key findings, analysis, and recommendations.",
  code:
    "Produce production-quality code with brief usage notes and any assumptions. Prefer clarity and correctness.",
  tasks:
    "Break down the request into tasks with priorities, dependencies, and estimated effort.",
  schedule:
    "Create a weekly schedule with time blocks, priorities, and checkpoints. Keep it realistic and balanced.",
  summary:
    "Summarize the content concisely, then list key action items.",
  brainstorm:
    "Generate creative options, then rank the top 3 with rationale."
};

const buildTaskInput = (inputText, imageSummaries, fileSummaries = []) => {
  const summariesText = imageSummaries.filter(Boolean).join("\n");
  const fileText = fileSummaries.filter(Boolean).join("\n");
  return [
    {
      type: "input_text",
      text: `User input text:\n${inputText || ""}`
    },
    {
      type: "input_text",
      text: `Image summaries:\n${summariesText || "(none)"}`
    },
    {
      type: "input_text",
      text: `File summaries:\n${fileText || "(none)"}`
    }
  ];
};

export async function runTaskModel(
  openai,
  type,
  inputText,
  imageSummaries,
  fileSummaries = []
) {
  const prompt = taskPrompts[type] || taskPrompts.general;
  const response = await openai.responses.create({
    model: "gpt-5-mini",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: prompt
          },
          ...buildTaskInput(inputText, imageSummaries, fileSummaries)
        ]
      }
    ]
  });

  return response.output_text || "";
}

export async function generatePresentation(openai, inputText, imageSummaries) {
  return runTaskModel(openai, "presentation", inputText, imageSummaries);
}

export async function generateReport(openai, inputText, imageSummaries) {
  return runTaskModel(openai, "report", inputText, imageSummaries);
}

export async function generateCode(openai, inputText, imageSummaries) {
  return runTaskModel(openai, "code", inputText, imageSummaries);
}

export async function generateTaskBreakdown(openai, inputText, imageSummaries) {
  return runTaskModel(openai, "tasks", inputText, imageSummaries);
}

export async function generateSchedule(openai, inputText, imageSummaries) {
  return runTaskModel(openai, "schedule", inputText, imageSummaries);
}

export async function generateSummary(openai, inputText, imageSummaries) {
  return runTaskModel(openai, "summary", inputText, imageSummaries);
}

export async function generateBrainstorm(openai, inputText, imageSummaries) {
  return runTaskModel(openai, "brainstorm", inputText, imageSummaries);
}

const availableModels = [
  "general",
  "presentation",
  "report",
  "code",
  "tasks",
  "schedule",
  "summary",
  "brainstorm"
];

const routerSystemPrompt = `You are a routing model that selects which task models to run for a user's request.
Return ONLY valid JSON with this shape:
{
  "steps": [
    {
      "model": "presentation|report|code|tasks|schedule|summary|brainstorm|general",
      "goal": "short description of what this step should produce",
      "done_criteria": "how to know this step is complete",
      "uses_previous": true|false
    }
  ]
}
Rules:
- You may choose multiple steps in sequence when a request is complex.
- Always include at least one step.
- If unsure, use "general".
- Keep steps minimal and ordered.
`;

const checkerSystemPrompt = `You are a strict reviewer. Evaluate the candidate output against the user request and provided materials. Reply ONLY JSON:
{
  "status": "pass"|"fail",
  "issues": ["short issue"],
  "fix_prompt": "single prompt that tells the model how to fix issues"
}
If everything satisfies the request, use status "pass" and empty issues and fix_prompt.
`;

const normalizeJson = (value, fallback) => {
  try {
    if (typeof value === "string") {
      return JSON.parse(value);
    }
    return value || fallback;
  } catch {
    return fallback;
  }
};

const runRouter = async (openai, inputText, imageSummaries, fileSummaries) => {
  const response = await openai.responses.create({
    model: "gpt-5-mini",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: routerSystemPrompt },
          ...buildTaskInput(inputText, imageSummaries, fileSummaries)
        ]
      }
    ]
  });

  const jsonText = response.output_text || "{}";
  const parsed = normalizeJson(jsonText, { steps: [] });
  const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
  const filteredSteps = steps.filter((step) =>
    availableModels.includes(step.model)
  );

  if (filteredSteps.length === 0) {
    return [
      {
        model: "general",
        goal: "Provide a helpful response",
        done_criteria: "Answer covers the request",
        uses_previous: false
      }
    ];
  }

  return filteredSteps;
};

const runChecker = async (openai, inputText, imageSummaries, fileSummaries, output) => {
  const response = await openai.responses.create({
    model: "gpt-5-mini",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: checkerSystemPrompt },
          ...buildTaskInput(inputText, imageSummaries, fileSummaries),
          { type: "input_text", text: `Candidate output:\n${output}` }
        ]
      }
    ]
  });

  const jsonText = response.output_text || "{}";
  const parsed = normalizeJson(jsonText, {
    status: "fail",
    issues: ["Checker returned invalid JSON."],
    fix_prompt: "Fix the output to satisfy the request."
  });

  return parsed;
};

export async function runClariceFlow(
  openai,
  inputText,
  imageSummaries,
  fileSummaries
) {
  console.log("[clarice] Starting flow");
  const steps = await runRouter(openai, inputText, imageSummaries, fileSummaries);
  console.log("[clarice] Router steps:", steps);
  const outputs = [];

  for (const step of steps) {
    console.log(`[clarice] Running step: ${step.model} (${step.goal})`);
    let iteration = 0;
    let lastOutput = "";
    let fixPrompt = "";
    let lastCheck = { status: "fail", issues: [], fix_prompt: "" };

    while (iteration < 3) {
      iteration += 1;
      console.log(`[clarice] Iteration ${iteration} for ${step.model}`);
      const augmentedInput = fixPrompt
        ? `${inputText}\n\nFix instructions: ${fixPrompt}`
        : inputText;

      const output = await runTaskModel(
        openai,
        step.model,
        augmentedInput,
        imageSummaries,
        fileSummaries
      );

      lastOutput = output;

      console.log(`[clarice] ${step.model} output length:`, output.length);

      const check = await runChecker(
        openai,
        inputText,
        imageSummaries,
        fileSummaries,
        output
      );
      lastCheck = check;

      console.log(`[clarice] Checker status for ${step.model}:`, check.status);

      if (check.status === "pass") {
        console.log(`[clarice] Step ${step.model} passed review`);
        break;
      }

      fixPrompt = check.fix_prompt || "Fix the output to satisfy the request.";
      console.log(`[clarice] Fix prompt for ${step.model}:`, fixPrompt);
    }

    outputs.push({
      model: step.model,
      goal: step.goal,
      output: lastOutput,
      iterations: iteration,
      review: lastCheck
    });
  }

  console.log("[clarice] Flow complete");
  return outputs;
}
