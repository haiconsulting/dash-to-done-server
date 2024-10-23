const express = require('express');
const OpenAI = require('openai');
const cors = require('cors');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { exec } = require('child_process');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const ASSISTANT_ID = process.env.ASSISTANT_KEY;
const openai = new OpenAI({ apiKey: process.env.REACT_APP_OPENAI_API_KEY });

// Enable CORS for all routes
app.use(cors());

// Parse JSON bodies
app.use(express.json());

app.post('/generate-tasks', async (req, res) => {
  console.log('Received request body:', req.body);
  const { input, teamMembers } = req.body;

  if (!process.env.REACT_APP_OPENAI_API_KEY) {
    console.error('OpenAI API key is not set');
    return res.status(500).json({ error: 'OpenAI API key is not set. Please check your environment variables.' });
  }

  try {
    console.log('Received input:', input);
    console.log('Team members:', teamMembers);

    console.log('Creating thread...');
    const thread = await openai.beta.threads.create();
    console.log('Thread created:', thread.id);

    console.log('Creating message...');
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: `Generate tasks based on this input: ${input}\n\nTeam Members:\n${teamMembers.map(member => `${member.name} - ${member.position} - ${member.duties}`).join('\n')}\n\nPlease assign tasks to team members based on their positions and duties.`
    });
    console.log('Message created');

    console.log('Creating run...');
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: ASSISTANT_ID
    });
    console.log('Run created:', run.id);

    console.log('Waiting for run to complete...');
    let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    while (runStatus.status !== 'completed') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      console.log('Run status:', runStatus.status);
    }

    console.log('Retrieving messages...');
    const messages = await openai.beta.threads.messages.list(thread.id);
    console.log('Messages retrieved:', messages.data.length);

    const assistantMessage = messages.data.find(message => message.role === 'assistant');
    if (!assistantMessage) {
      throw new Error('No response from assistant');
    }

    console.log('Assistant message:', assistantMessage.content[0].text.value);

    const tasksString = assistantMessage.content[0].text.value;
    let parsedTasks;

    try {
      parsedTasks = JSON.parse(tasksString);
    } catch (error) {
      console.error('Error parsing JSON:', error);
      throw new Error('Invalid JSON response from assistant');
    }

    if (!Array.isArray(parsedTasks.tasks)) {
      throw new Error('Invalid tasks format in assistant response');
    }

    const tasks = parsedTasks.tasks.map(task => ({
      id: task.id || Date.now() + Math.random(),
      title: task.title,
      description: task.description || '',
      status: task.status || 'To Do',
      assigned_team_member: task.assigned_team_member,
      assigned_team_member_id: teamMembers.find(member => member.name === task.assigned_team_member)?.id || null
    }));

    console.log('Generated tasks:', tasks);
    res.json({ tasks });
  } catch (error) {
    console.error('Error generating tasks:', error);
    res.status(500).json({ error: 'Failed to generate tasks', details: error.message });
  }
});

// New endpoint to save state
app.post('/save-state', async (req, res) => {
  try {
    const state = req.body;
    await fs.writeFile(path.join(__dirname, 'appState.json'), JSON.stringify(state, null, 2));
    res.json({ message: 'State saved successfully' });
  } catch (error) {
    console.error('Error saving state:', error);
    res.status(500).json({ error: 'Failed to save state' });
  }
});

// New endpoint to load state
app.get('/load-state', async (req, res) => {
  try {
    const data = await fs.readFile(path.join(__dirname, 'appState.json'), 'utf8');
    const state = JSON.parse(data);
    res.json(state);
  } catch (error) {
    console.error('Error loading state:', error);
    res.status(500).json({ error: 'Failed to load state' });
  }
});

// Function to check if certificates exist
const certificatesExist = () => {
  const keyPath = path.join(__dirname, 'certificates', 'private.key');
  const certPath = path.join(__dirname, 'certificates', 'certificate.crt');
  return fsSync.existsSync(keyPath) && fsSync.existsSync(certPath);
};

// Function to generate/renew certificate
const renewCertificate = () => {
  return new Promise((resolve, reject) => {
    exec('./generate-ip-cert.sh -ip "your.actual.public.ip"', (error, stdout, stderr) => {
      if (error) {
        console.error(`Error renewing certificate: ${error}`);
        reject(error);
      } else {
        console.log(`Certificate renewed: ${stdout}`);
        resolve();
      }
    });
  });
};

// Renew certificate every 90 days if running in production
if (process.env.NODE_ENV === 'production') {
  setInterval(renewCertificate, 90 * 24 * 60 * 60 * 1000);
}

let server;

if (certificatesExist()) {
  // Create HTTPS server
  server = https.createServer({
    key: fsSync.readFileSync(path.join(__dirname, 'certificates', 'private.key')),
    cert: fsSync.readFileSync(path.join(__dirname, 'certificates', 'certificate.crt'))
  }, app);
} else {
  console.warn('SSL certificates not found. Running in HTTP mode.');
  server = http.createServer(app);
}

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Initial certificate generation (only in production)
if (process.env.NODE_ENV === 'production') {
  renewCertificate().catch(console.error);
}
