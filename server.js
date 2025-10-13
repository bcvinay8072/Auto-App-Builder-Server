// A full-stack Node.js application to automatically build and deploy web apps
// based on API requests, using LLMs for code generation and the GitHub API for deployment.
// Current date for context: Monday, October 13, 2025.

// --- 1. IMPORTS AND SETUP ---
// Import all necessary libraries: express for the server, dotenv for environment variables,
// axios for making HTTP requests, Octokit for the GitHub API, and the Google AI library for the LLM.
const express = require('express');
const dotenv = require('dotenv');
const axios = require('axios');
const { Octokit } = require('@octokit/rest');
const { GoogleGenerativeAI } = require('@google/generative-ai'); // <<< Using Google's library

// --- 2. INITIALIZATION ---
// Load environment variables from the .env file.
dotenv.config();

// Initialize the Express app.
const app = express();

// Use express.json() middleware to automatically parse JSON request bodies.
app.use(express.json());

// Initialize Octokit with the GitHub Personal Access Token for authentication.
const octokit = new Octokit({ auth: process.env.GITHUB_PAT });

// Initialize the Google Generative AI client with the Gemini API key.
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- 3. THE MAIN API ENDPOINT ---
// Create a POST endpoint at /api/build to receive task requests.
app.post('/api/build', (req, res) => {
    // Log that a request has been received to the console.
    console.log('Received a new build request...');

    // Immediately validate the secret from the request body against the environment variable.
    if (req.body.secret !== process.env.STUDENT_SECRET) {
        console.error('Invalid secret received.');
        return res.status(403).json({ message: 'Error: Invalid secret.' });
    }

    // CRITICAL: Respond immediately with a 200 OK to acknowledge receipt of the request.
    res.status(200).json({ message: 'Request received and is being processed.' });

    // Call the asynchronous function to handle the build process in the background.
    processBuildRequest(req.body);
});


// --- 4. THE BACKGROUND PROCESSING LOGIC ---
// Define an async function to handle the core logic of building, deploying, and notifying.
async function processBuildRequest(body) {
    // Log the task ID and round for tracking purposes.
    console.log(`Processing task: ${body.task}, Round: ${body.round}`);

    try {
        const repoName = body.task;
        const { data: { login } } = await octokit.users.getAuthenticated();

        if (body.round === 1) {
            // --- ROUND 1: BUILD & DEPLOY ---
            console.log('--- Executing Round 1: Build & Deploy ---');
            const brief = body.brief;
            const attachments = body.attachments || [];
            let attachmentContent = 'No attachments.';
            if (attachments.length > 0) {
                const firstAttachment = attachments[0];
                const decodedContent = Buffer.from(firstAttachment.url.split(',')[1], 'base64').toString('utf-8');
                attachmentContent = `The project uses an attachment named '${firstAttachment.name}'. Its content is:\n"""\n${decodedContent}\n"""`;
            }

            const llmPrompt = `
You are an expert front-end web developer specializing in creating clean, efficient, and self-contained HTML files.
## TASK
Your task is to create a single, self-contained \`index.html\` file based on the user's brief.
## CONSTRAINTS
1. You MUST generate a single \`index.html\` file.
2. All CSS and JavaScript code MUST be embedded directly within the HTML file using \`<style>\` and \`<script>\` tags.
3. Do not use any external file paths. External libraries from CDNs are allowed if requested.
## INPUT & CONTEXT
**Brief:**
"""
${brief}
"""
**Attachments:**
${attachmentContent}
**Evaluation Checks:**
The code will be evaluated against these checks:
"""
${body.checks.join('\n')}
"""
## OUTPUT
Provide ONLY the complete HTML code for the \`index.html\` file, enclosed in a single markdown code block.`;

            console.log('Generating code with LLM (Google Gemini)...');
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            const result = await model.generateContent(llmPrompt);
            const response = await result.response;
            let generatedHtml = response.text();
            
            if (generatedHtml.startsWith('```html')) {
                generatedHtml = generatedHtml.substring(7, generatedHtml.length - 3).trim();
            }

            console.log(`Creating repository: ${login}/${repoName}`);
            await octokit.repos.createForAuthenticatedUser({
                name: repoName,
                private: false,
            });

            const licenseContent = `MIT License

Copyright (c) 2025 [Chenchu Vinay Boga]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;
            
            const readmeContent = `# ${repoName}\n\n## Summary\n\nThis project was automatically generated to fulfill the following brief: *${brief}*\n\n## Setup & Usage\n\nThis is a static web page. Simply open the deployed GitHub Pages URL to view and use the application.\n\n## Code Explanation\n\nThe application is contained within a single \`index.html\` file. All styling is provided via a \`<style>\` tag and all logic is contained within a \`<script>\` tag.\n\n## License\n\nThis project is licensed under the MIT License.`;

            console.log('Pushing files to the repository...');
            const commitMessage = 'Initial commit: Add application files';
            await octokit.repos.createOrUpdateFileContents({
                owner: login, repo: repoName, path: 'index.html',
                message: commitMessage, content: Buffer.from(generatedHtml).toString('base64'),
            });
            await octokit.repos.createOrUpdateFileContents({
                owner: login, repo: repoName, path: 'README.md',
                message: commitMessage, content: Buffer.from(readmeContent).toString('base64'),
            });
            await octokit.repos.createOrUpdateFileContents({
                owner: login, repo: repoName, path: 'LICENSE',
                message: commitMessage, content: Buffer.from(licenseContent).toString('base64'),
            });
            
            console.log('Enabling GitHub Pages...');
            await octokit.repos.createPagesSite({
                owner: login, repo: repoName,
                source: { branch: 'main', path: '/' },
            });
        } else if (body.round === 2) {
            console.log('--- Executing Round 2: Revise & Redeploy ---');

            console.log(`Fetching existing code from ${login}/${repoName}...`);
            const { data: existingFile } = await octokit.repos.getContent({
                owner: login, repo: repoName, path: 'index.html',
            });
            const originalHtml = Buffer.from(existingFile.content, 'base64').toString('utf-8');

            const revisionPrompt = `
You are an expert front-end web developer who is excellent at modifying and refactoring existing code to add new features.
## TASK
Your task is to modify the provided HTML code to implement a new feature described in the brief.
## CONSTRAINTS
1. You MUST return the complete, updated code for the single \`index.html\` file.
2. All new CSS and JavaScript code must also be embedded directly within the HTML file.
3. Ensure the original functionality still works correctly alongside the new feature.
## INPUT & CONTEXT
**Original Code:**
This is the existing \`index.html\` file that you need to modify:
\`\`\`html
${originalHtml}
\`\`\`
**New Brief for Revision:**
"""
${body.brief}
"""
## OUTPUT
Provide ONLY the complete, updated HTML code for the \`index.html\` file, enclosed in a single markdown code block.`;

            console.log('Generating revised code with LLM (Google Gemini)...');
            const model = genAI.getGenerativeModel({ model: "gemini-pro" });
            const result = await model.generateContent(revisionPrompt);
            const response = await result.response;
            let updatedHtml = response.text();
            
            if (updatedHtml.startsWith('```html')) {
                updatedHtml = updatedHtml.substring(7, updatedHtml.length - 3).trim();
            }

            console.log('Pushing updated file to the repository...');
            await octokit.repos.createOrUpdateFileContents({
                owner: login, repo: repoName, path: 'index.html',
                message: 'Feat: Update application based on round 2 brief',
                content: Buffer.from(updatedHtml).toString('base64'),
                sha: existingFile.sha,
            });
        }

        const { data: commitData } = await octokit.repos.getCommit({
            owner: login, repo: repoName, ref: 'heads/main',
        });
        const commitSha = commitData.sha;
        
        const pagesUrl = `https://${login}.github.io/${repoName}/`;
        if (body.round === 1) {
            console.log(`Deployment URL (will be active shortly): ${pagesUrl}`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        } else {
            console.log(`Redeployment triggered for URL: ${pagesUrl}`);
        }

        const notificationPayload = {
            email: body.email, task: body.task, round: body.round, nonce: body.nonce,
            repo_url: `https://github.com/${login}/${repoName}`,
            commit_sha: commitSha, pages_url: pagesUrl,
        };
        
        console.log('Sending notification to evaluation URL:', body.evaluation_url);
        let notificationSuccess = false;
        for (let i = 0; i < 4; i++) {
            try {
                await axios.post(body.evaluation_url, notificationPayload);
                console.log('Successfully notified evaluation server.');
                notificationSuccess = true;
                break;
            } catch (error) {
                console.warn(`Attempt ${i + 1} to notify failed. Retrying in ${Math.pow(2, i)}s...`);
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
            }
        }
        if (!notificationSuccess) {
            console.error('Failed to notify evaluation server after multiple retries.');
        }

    } catch (error) {
        console.error('An error occurred during the build process:', error);
    }
}

// --- 5. START THE SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Auto-App Builder server is running on http://localhost:${PORT}`);
});