// agent-definition.js

const runBtn = document.getElementById('run-btn');
const resetBtn = document.getElementById('reset-btn');
const logCode = document.getElementById('log-code');
const logAgent = document.getElementById('log-agent');

// Code Elements
const codeParticle = document.getElementById('particle-code');
const codePath = document.getElementById('path-code');
const codeNode1 = document.getElementById('code-step-1');
const codeNode2 = document.getElementById('code-step-2');
const codeNode3 = document.getElementById('code-step-3');
const codeOutcome = document.getElementById('code-outcome');

// Agent Elements
const agentParticle = document.getElementById('particle-agent');
const pathInit = document.getElementById('path-agent-init');
const pathBranchA = document.getElementById('path-agent-branchA');
const pathBranchB = document.getElementById('path-agent-branchB');
const pathFinalA = document.getElementById('path-agent-finalA');
const pathFinalB = document.getElementById('path-agent-finalB');
const agentInput = document.getElementById('agent-input');
const agentCore = document.getElementById('agent-core');
const agentOptA = document.getElementById('agent-opt-search');
const agentOptB = document.getElementById('agent-opt-calc');
const agentOutcome = document.getElementById('agent-outcome');

let isRunning = false;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function appendLog(element, text) {
  const div = document.createElement('div');
  div.className = 'log-entry';
  div.textContent = text;
  element.appendChild(div);
  element.scrollTop = element.scrollHeight;
}

// Particle Animation Logic along SVG Path
function animateParticle(particle, pathNode, duration) {
  return new Promise(resolve => {
    particle.classList.remove('hidden');
    const pathLength = pathNode.getTotalLength();
    const startTime = performance.now();

    function step(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      const point = pathNode.getPointAtLength(progress * pathLength);
      particle.setAttribute('cx', point.x);
      particle.setAttribute('cy', point.y);

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        particle.classList.add('hidden');
        resolve();
      }
    }
    requestAnimationFrame(step);
  });
}

async function runCodeSimulation() {
  appendLog(logCode, "[1/4] Starting sequential input processing...");
  codeNode1.classList.add('active');
  await animateParticle(codeParticle, codePath, 3000); // the path goes exactly top to bottom
  codeNode1.classList.remove('active');
}

// More granular run to hit each node
async function executeCodeStep(node, logText) {
  appendLog(logCode, logText);
  node.classList.add('active');
  await delay(800);
  node.classList.remove('active');
}

async function runCode() {
  logCode.innerHTML = "";
  
  // Step 1
  appendLog(logCode, "> def process(data):");
  codeNode1.classList.add('active');
  await animateParticle(codeParticle, createSubPath(codePath, 0, 0.33), 800);
  codeNode1.classList.remove('active');
  
  // Step 2
  appendLog(logCode, ">   if data.valid:");
  codeNode2.classList.add('active');
  await animateParticle(codeParticle, createSubPath(codePath, 0.33, 0.66), 800);
  codeNode2.classList.remove('active');

  // Step 3
  appendLog(logCode, ">     save_db()");
  codeNode3.classList.add('active');
  await animateParticle(codeParticle, createSubPath(codePath, 0.66, 1.0), 800);
  codeNode3.classList.remove('active');

  // Outcome
  appendLog(logCode, "> return Success (Expected)");
  codeOutcome.classList.add('active');
}

// Helper to animate part of a straight line
function animateStraight(particle, startY, endY, duration) {
  return new Promise(resolve => {
    particle.classList.remove('hidden');
    const startTime = performance.now();
    function step(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      const y = startY + (endY - startY) * progress;
      particle.setAttribute('cx', 200); // Fixed for center alignment
      particle.setAttribute('cy', y);

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        particle.classList.add('hidden');
        resolve();
      }
    }
    requestAnimationFrame(step);
  });
}

// Properly isolated Code Run
async function simulateCode() {
  logCode.innerHTML = "";
  appendLog(logCode, "Executing predefined steps...");
  
  codeNode1.classList.add('active');
  await delay(400);
  await animateStraight(codeParticle, 50, 150, 600);
  codeNode1.classList.remove('active');

  appendLog(logCode, "Step A executed. Expected status.");
  codeNode2.classList.add('active');
  await delay(400);
  await animateStraight(codeParticle, 150, 250, 600);
  codeNode2.classList.remove('active');

  appendLog(logCode, "Step B executed. Expected status.");
  codeNode3.classList.add('active');
  await delay(400);
  await animateStraight(codeParticle, 250, 350, 600);
  codeNode3.classList.remove('active');

  appendLog(logCode, "Workflow Complete: KNOWN OUTCOME.");
  codeOutcome.classList.add('active');
}

async function simulateAgent() {
  logAgent.innerHTML = "";
  
  appendLog(logAgent, "[ITERATION 1] Receiving ambiguous goal...");
  agentInput.classList.add('active');
  await delay(400);
  
  // Particle moves to Core
  await animateParticle(agentParticle, pathInit, 600);
  agentInput.classList.remove('active');
  
  // Core decides
  agentCore.classList.add('active');
  appendLog(logAgent, "LLM Core is thinking based on available tools...");
  await delay(1200);
  agentCore.classList.remove('active');

  // Randomly select path to demonstrate unpredictability
  const isBranchA = Math.random() > 0.5;
  
  if (isBranchA) {
    appendLog(logAgent, "Decision: Need to find current information (Web Search)");
    pathBranchA.classList.remove('path-hidden');
    pathBranchA.classList.add('active-path');
    
    await animateParticle(agentParticle, pathBranchA, 800);
    agentOptA.classList.add('chosen', 'active');
    appendLog(logAgent, "Result: Successfully fetched web data.");
    await delay(600);
    agentOptA.classList.remove('active');
    
    appendLog(logAgent, "[ITERATION 2] Routing to Synthesize...");
    pathFinalA.classList.remove('path-hidden');
    await animateParticle(agentParticle, pathFinalA, 800);
    
  } else {
    appendLog(logAgent, "Decision: Goal requires mathematical resolution (Calculate)");
    pathBranchB.classList.remove('path-hidden');
    pathBranchB.classList.add('active-path');
    
    await animateParticle(agentParticle, pathBranchB, 800);
    agentOptB.classList.add('chosen', 'active');
    appendLog(logAgent, "Result: Computed integers successfully.");
    await delay(600);
    agentOptB.classList.remove('active');
    
    appendLog(logAgent, "[ITERATION 2] Routing to Synthesize...");
    pathFinalB.classList.remove('path-hidden');
    await animateParticle(agentParticle, pathFinalB, 800);
  }

  appendLog(logAgent, "Agent has satisfied constraints. Emitting completion...");
  agentOutcome.classList.add('active');
}

async function runSimulations() {
  if (isRunning) return;
  isRunning = true;

  startBtn.classList.add('hidden');
  resetBtn.classList.remove('hidden');
  resetBtn.disabled = true;

  // Run them concurrently
  await Promise.all([simulateCode(), simulateAgent()]);

  resetBtn.disabled = false;
  isRunning = false;
}

function resetSimulations() {
  // Clear classes
  const elements = [
    codeNode1, codeNode2, codeNode3, codeOutcome,
    agentInput, agentCore, agentOptA, agentOptB, agentOutcome
  ];
  elements.forEach(el => el.classList.remove('active', 'chosen'));

  // Clear agent paths
  const paths = [pathBranchA, pathBranchB, pathFinalA, pathFinalB];
  paths.forEach(p => {
    p.classList.add('path-hidden');
    p.classList.remove('active-path');
  });

  // Reset logs
  logCode.innerHTML = '<div class="log-entry" style="color:var(--text-muted);border:none;">Awaiting execution...</div>';
  logAgent.innerHTML = '<div class="log-entry" style="color:var(--text-muted);border:none;">Awaiting execution...</div>';

  startBtn.classList.remove('hidden');
  resetBtn.classList.add('hidden');
}

const startBtn = document.getElementById('run-btn');
startBtn.addEventListener('click', runSimulations);
resetBtn.addEventListener('click', resetSimulations);
