// control-loop.js

const startBtn = document.getElementById('start-btn');
const resetBtn = document.getElementById('reset-btn');
const statusText = document.getElementById('status-text');
const traceLog = document.getElementById('trace-log');
const iterationBadge = document.getElementById('iteration-badge');
const agentCore = document.querySelector('.node-agent-core');
const flowParticle = document.getElementById('flow-particle');
const particlePath = document.getElementById('particle-path');

// Flow path coordinates (t = 0 to 1 along the path)
const pathLength = particlePath.getTotalLength();

const nodes = {
  observe: document.getElementById('node-observe'),
  reason: document.getElementById('node-reason'),
  act: document.getElementById('node-act'),
  reflect: document.getElementById('node-reflect')
};

// The execution script for "What is the weather in my exact current location today?"
const executionScript = [
  // ITERATION 1
  { iter: 1, node: 'observe', text: 'Received prompt: "What is the weather in my exact current location today?" Missing date and location.', status: 'Parsing user intent and identifying missing information.' },
  { iter: 1, node: 'reason', text: 'To get the weather, I first need the current date and user location. I will call get_date() to find out "today".', status: 'Planning sequence: Get Date -> Get Location -> Get Weather.' },
  { iter: 1, node: 'act', text: 'Executing tool call...', status: 'Calling internal tool get_date()',
    tool: { name: 'get_date()', result: '2026-03-28' }
  },
  { iter: 1, node: 'reflect', text: 'I now have the date (2026-03-28). The location is still unknown.', status: 'Reviewing state: Date retrieved successfully. Location pending.' },

  // ITERATION 2
  { iter: 2, node: 'observe', text: 'State updated: Context has Date[2026-03-28]. Need location.', status: 'Context updated. Identifying next missing variable (location).' },
  { iter: 2, node: 'reason', text: 'I need the user\'s location to check the weather. I will use the get_user_location() tool.', status: 'Determining tool: get_user_location().' },
  { iter: 2, node: 'act', text: 'Executing tool call...', status: 'Calling internal tool get_user_location()',
    tool: { name: 'get_user_location()', result: 'San Francisco, CA' }
  },
  { iter: 2, node: 'reflect', text: 'I now have the location (San Francisco, CA) and the date (2026-03-28).', status: 'Reviewing state: All dependencies met for checking weather.' },

  // ITERATION 3
  { iter: 3, node: 'observe', text: 'State updated: Context has Date[2026-03-28] and Location[San Francisco].', status: 'Context updated. Ready to perform final operation.' },
  { iter: 3, node: 'reason', text: 'I have all required parameters. I will now retrieve the weather using get_weather(location, date).', status: 'Formulating final tool call with gathered context.' },
  { iter: 3, node: 'act', text: 'Executing tool call...', status: 'Calling external API get_weather(location="San Francisco, CA", date="2026-03-28")',
    tool: { name: 'get_weather(location="San Francisco, CA", date="2026-03-28")', result: 'Sunny, 72°F' }
  },
  { iter: 3, node: 'reflect', text: 'I have the weather data. The task is complete. Ready to synthesize answer.', status: 'Reviewing state: Goal achieved. Synthesizing final natural language response.' },

  // FINISH
  { iter: 3, node: 'finish', text: 'Generated final response for the user.', status: 'Task complete! Agent achieved the user\'s goal.',
    final: 'Today\'s weather in San Francisco is sunny and 72°F.'
  }
];

let isRunning = false;

// ── Particle Flow Animation ────────────────────────────
function animateParticle(startPoint, endPoint, duration) {
  return new Promise(resolve => {
    flowParticle.classList.remove('hidden');
    const startTime = performance.now();
    
    // Map standard positions to SVG path length values (Approximate quarter lengths)
    // 0: Top (Observe), 1: Right (Reason), 2: Bottom (Act), 3: Left (Reflect)
    // The path starts at Top (0) and goes clockwise
    const pointToLength = {
      0: 0,
      1: pathLength * 0.25,
      2: pathLength * 0.5,
      3: pathLength * 0.75,
      4: pathLength // Back to top
    };
    
    const startL = pointToLength[startPoint];
    const endL   = pointToLength[endPoint];

    function step(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Easing (easeInOutQuad)
      const ease = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      
      const currentL = startL + (endL - startL) * ease;
      const point = particlePath.getPointAtLength(currentL);
      
      flowParticle.setAttribute('cx', point.x);
      flowParticle.setAttribute('cy', point.y);

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        flowParticle.classList.add('hidden');
        resolve();
      }
    }
    requestAnimationFrame(step);
  });
}

const nodeOrder = { 'observe': 0, 'reason': 1, 'act': 2, 'reflect': 3 };

async function runLoop() {
  if (isRunning) return;
  isRunning = true;
  
  startBtn.classList.add('hidden');
  resetBtn.classList.remove('hidden');
  resetBtn.disabled = true;
  
  traceLog.innerHTML = '';
  
  for (let i = 0; i < executionScript.length; i++) {
    const step = executionScript[i];
    
    // Update Iteration Badge
    iterationBadge.textContent = `ITERATION ${step.iter}`;
    
    if (step.node === 'finish') {
      agentCore.classList.remove('thinking');
      statusText.textContent = step.status;
      addTraceItem(step);
      break;
    }

    // Agent Think Animation
    agentCore.classList.add('thinking');
    
    // Flow Particle Animation (from core to node)
    // For simplicity, we just animate along the circular path from previous node to current
    if (i > 0 && executionScript[i-1].node !== 'finish') {
      let prevNodeKey = executionScript[i-1].node;
      let currNodeKey = step.node;
      let pStart = nodeOrder[prevNodeKey];
      let pEnd = nodeOrder[currNodeKey];
      
      // Wrap around from reflect(3) to observe(0=4)
      if (pStart === 3 && pEnd === 0) pEnd = 4;
      
      await animateParticle(pStart, pEnd, 600);
    }
    
    // Deactivate all nodes
    Object.values(nodes).forEach(n => n.classList.remove('active'));
    
    // Activate target node
    const targetNode = nodes[step.node];
    targetNode.classList.add('active');
    
    // Update status text
    statusText.style.opacity = 0;
    setTimeout(() => {
      statusText.textContent = step.status;
      statusText.style.opacity = 1;
    }, 200);
    
    // Add trace item to UI
    addTraceItem(step);
    
    // Wait for reading
    await sleep(step.tool ? 1800 : 1200);
  }
  
  // Finish
  Object.values(nodes).forEach(n => n.classList.remove('active'));
  resetBtn.disabled = false;
  isRunning = false;
}

function addTraceItem(step) {
  const item = document.createElement('div');
  item.className = 'trace-item';
  
  let toolHtml = '';
  if (step.tool) {
    toolHtml = `
      <div class="trace-tool-call">
        <div class="tool-action">🔧 Tool Called: ${step.tool.name}</div>
        <div class="tool-result">${step.tool.result}</div>
      </div>
    `;
  }
  
  let finalHtml = '';
  if (step.final) {
    finalHtml = `
      <div class="trace-final-answer">
        ${step.final}
      </div>
    `;
  }
  
  item.innerHTML = `
    <div class="trace-item-header">
      <span class="trace-node-badge ${step.node}">${step.node.toUpperCase()}</span>
    </div>
    <div class="trace-node-text">${step.text}</div>
    ${toolHtml}
    ${finalHtml}
  `;
  
  traceLog.appendChild(item);
  traceLog.scrollTop = traceLog.scrollHeight;
}

function resetLoop() {
  Object.values(nodes).forEach(n => n.classList.remove('active'));
  agentCore.classList.remove('thinking');
  flowParticle.classList.add('hidden');
  
  traceLog.innerHTML = '<div class="empty-trace">Click "Run Loop" to see the agent work through the problem step by step.</div>';
  statusText.textContent = 'Waiting to start the control loop...';
  iterationBadge.textContent = 'ITERATION 0';
  
  startBtn.classList.remove('hidden');
  resetBtn.classList.add('hidden');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

startBtn.addEventListener('click', runLoop);
resetBtn.addEventListener('click', resetLoop);
