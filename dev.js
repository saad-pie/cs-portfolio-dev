import { GoogleGenAI, Type } from "https://esm.run/@google/genai";

const GITHUB_API_URL = "https://api.github.com";
const REPO_OWNER = "saad-pie";
const REPO_NAME = "cs-portfolio-dev";

// DOM elements
const githubTokenInput = document.getElementById('githubToken');
const geminiApiKeyInput = document.getElementById('geminiApiKey');
const chatHistory = document.getElementById('chat-history');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const previewFrame = document.getElementById('preview-frame');

let ai;
let isWorking = false;

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    files: {
      type: Type.ARRAY,
      description: "An array of files to update or create. For updates, include the full new content. For creations, provide the new filename and content. Only include files that have changed or are new.",
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "The filename, e.g., index.html or about.html" },
          content: { type: Type.STRING, description: "The complete new code content for the file." },
        },
        required: ["name", "content"],
      },
    },
  },
  required: ["files"],
};

function encodeUnicodeToBase64(str) {
    return btoa(
        encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) =>
            String.fromCharCode(parseInt(p1, 16))
        )
    );
}

function decodeUnicodeFromBase64(b64) {
    return decodeURIComponent(
        atob(b64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    );
}


function updateWorkingState(working) {
    isWorking = working;
    sendBtn.disabled = isWorking;
    chatInput.disabled = isWorking;
    chatInput.placeholder = isWorking ? "AI is working..." : "e.g., Add a product list";
}

// Load keys from localStorage
githubTokenInput.value = localStorage.getItem('githubToken') || '';
geminiApiKeyInput.value = localStorage.getItem('geminiApiKey') || '';

// Save keys to localStorage on change
githubTokenInput.addEventListener('input', () => localStorage.setItem('githubToken', githubTokenInput.value));
geminiApiKeyInput.addEventListener('input', () => {
    localStorage.setItem('geminiApiKey', geminiApiKeyInput.value);
    try {
        if (geminiApiKeyInput.value) {
            ai = new GoogleGenAI({ apiKey: geminiApiKeyInput.value });
            addMessage('system', 'Gemini AI initialized.');
        } else {
            ai = null;
        }
    } catch (e) {
        console.error("Failed to initialize Gemini AI:", e);
        addMessage('system', 'Error: Invalid Gemini API Key format.');
        ai = null;
    }
});

try {
    if (geminiApiKeyInput.value) {
        ai = new GoogleGenAI({ apiKey: geminiApiKeyInput.value });
    }
} catch (e) {
    console.error("Failed to initialize Gemini AI from stored key:", e);
    ai = null;
}


// Chat logic
sendBtn.addEventListener('click', handleSend);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !isWorking) handleSend();
});

async function handleSend() {
    const prompt = chatInput.value.trim();
    if (!prompt || isWorking) return;

    const githubToken = githubTokenInput.value;
    const geminiApiKey = geminiApiKeyInput.value;

    if (!githubToken || !geminiApiKey) {
        addMessage('system', 'Error: Please provide both GitHub Token and Gemini API Key.');
        return;
    }
    if (!ai) {
        addMessage('system', 'Error: Gemini AI not initialized. Check your API Key.');
        return;
    }

    addMessage('user', prompt);
    chatInput.value = '';
    updateWorkingState(true);
    
    try {
        addMessage('system', 'Fetching current website files from GitHub...');
        const files = await getRepoFiles();
        
        const filesContentString = files.map(f => `
--- File: ${f.name} ---
${f.content}
`).join('\n\n');

        const fullPrompt = `
You are an expert AI web developer, acting as an autonomous agent with full read/write access to this GitHub repository. Your goal is to intelligently modify the website based on the user's request.

**CORE CAPABILITIES:**

1.  **JSON Database:**
    *   You can create and manage a simple database using a file named `database.json` in the root of the repository.
    *   To implement features like product lists, blog posts, portfolios, or guestbooks, you should:
        1.  Create or update `database.json` with the required data in a structured array of objects.
        2.  Update the JavaScript file (`script.js`) to fetch (`fetch('./database.json')`) and parse this data.
        3.  Dynamically generate HTML elements from the fetched data and inject them into the main HTML file.
    *   **Example User Request:** "Add a portfolio section with 3 projects."
    *   **Your Action:** Create `database.json` with project data, and update `script.js` and `index.html` to display it.

2.  **Image Placeholders:**
    *   When the user requests images, use a placeholder service like 'https://picsum.photos/'.
    *   Construct URLs like `https://picsum.photos/800/600?random=1` to get different images. Use the `?random=N` query parameter to ensure unique images.

**CRITICAL RULES & SELF-CORRECTION:**

Before finalizing your response, you MUST review your plan and code against these rules:

1.  **File Paths:** All paths in `href`, `src`, and `fetch` calls must be relative (e.g., `./style.css`, `./database.json`).
2.  **Integrate New Pages:** If you create a new HTML page (e.g., 'about.html'), you MUST add a navigation link to it in the navigation bar of all other existing HTML pages. The user must be able to navigate seamlessly.
3.  **Data Binding:** If you use `database.json`, ensure the JavaScript correctly fetches the data, iterates through it, and renders it to the DOM. Check for potential errors like trying to access elements that haven't loaded yet (use `DOMContentLoaded`).
4.  **Completeness:** All code must be complete and functional. No placeholders like "// Your code here".
5.  **Efficiency:** Only return files that are new or have been modified. Do not include unchanged files in your response.

**EXISTING WEBSITE FILES:**
${filesContentString}

**USER REQUEST:**
"${prompt}"

Based on your capabilities and the user's request, provide the necessary file creations or updates.
`;

        addMessage('system', 'Analyzing request and generating code...');
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: fullPrompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: responseSchema,
            },
        });
        
        const jsonText = response.text.trim();
        const result = JSON.parse(jsonText);

        if (!result.files || !Array.isArray(result.files) || result.files.length === 0) {
            addMessage('system', 'AI did not suggest any file changes. Try rephrasing your request.');
            updateWorkingState(false);
            return;
        }

        addMessage('system', `Committing ${result.files.length} file(s) to GitHub...`);
        
        for (const file of result.files) {
            const originalFile = files.find(f => f.name === file.name);
            await uploadRepoFile(file.name, file.content, originalFile?.sha);
            addMessage('system', `Pushed: ${file.name} (${originalFile ? 'updated' : 'created'})`);
        }

        addMessage('system', 'Updates pushed successfully! Refreshing preview...');
        previewFrame.src = './index.html?t=' + new Date().getTime(); // bust cache

    } catch (error) {
        console.error(error);
        addMessage('system', `An error occurred: ${error.message}`);
    } finally {
        updateWorkingState(false);
    }
}

function addMessage(sender, text) {
    const messageEl = document.createElement('div');
    messageEl.className = `p-3 rounded-lg max-w-full w-fit ${sender === 'user' ? 'bg-blue-600 self-end text-white' : 'bg-gray-700 self-start'}`;
    messageEl.textContent = text;
    chatHistory.appendChild(messageEl);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

async function getRepoFiles() {
    const githubToken = githubTokenInput.value;
    const url = `${GITHUB_API_URL}/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/main?recursive=1`;
    const response = await fetch(url, { headers: { 'Authorization': `token ${githubToken}` } });
    if (!response.ok) throw new Error(`GitHub API error fetching tree: ${response.statusText}`);
    const { tree, truncated } = await response.json();

    if (truncated) {
        addMessage('system', 'Warning: Repository is too large, some files may have been omitted from context.');
    }

    const textFiles = tree.filter(item => item.type === 'blob' && !item.path.startsWith('dev.'));
    
    const filePromises = textFiles.map(async file => {
        const fileResponse = await fetch(file.url, { headers: { 'Authorization': `token ${githubToken}`, 'Accept': 'application/vnd.github.v3.raw' } });
        if (!fileResponse.ok) throw new Error(`Failed to fetch file ${file.path}`);
        const { content, encoding } = await fileResponse.json();
        if (encoding !== 'base64') throw new Error(`Unexpected encoding for ${file.path}: ${encoding}`);
        return { name: file.path, content: decodeUnicodeFromBase64(content), sha: file.sha };
    });

    return Promise.all(filePromises);
}

async function uploadRepoFile(path, content, sha) {
    const githubToken = githubTokenInput.value;
    const url = `${GITHUB_API_URL}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
    
    const body = {
        message: `AI edit: update ${path}`,
        content: encodeUnicodeToBase64(content),
        branch: 'main'
    };

    if (sha) {
        body.sha = sha;
    }

    const response = await fetch(url, {
        method: 'PUT',
        headers: {
            'Authorization': `token ${githubToken}`,
            'Accept': 'application/vnd.github.v3+json',
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Failed to upload ${path}: ${error.message}`);
    }
}
