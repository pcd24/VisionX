Installation and Running VisionX
Prerequisites

    Node.js (v16.x or higher)
    npm (v8.x or higher)

Commands to run

1)npm install

2)npm install express

3)create the env.js file find the format in server.js file 

The File Should look like this:

const JWT_SECRET = "your-very-secure-secret-key"
const PEXELS_API_KEY = "API_PLACEHOLDER"
const HF_API_TOKEN = "API_PLACEHOLDER";

module.exports =  { JWT_SECRET, PEXELS_API_KEY,HF_API_TOKEN };

4)node server.js
