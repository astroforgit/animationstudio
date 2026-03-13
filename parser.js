const fs = require('fs');
const path = require('path');

// 1. Setup Input/Output paths
const INPUT_FILE = path.join(__dirname, 'DefineSprite_45', 'frames.html');
const OUTPUT_FILE = path.join(__dirname, 'editor', 'animation_data.json');

// Helper to convert transformation matrix[a,b,c,d,e,f] into UI-friendly values
function decomposeMatrix(matrix) {
    const[a, b, c, d, e, f] = matrix;
    const delta = a * d - b * c;

    let scaleX = 0, scaleY = 0, rotation = 0;

    if (a !== 0 || b !== 0) {
        const r = Math.sqrt(a * a + b * b);
        rotation = Math.atan2(b, a);
        scaleX = r;
        scaleY = delta / r;
    } else if (c !== 0 || d !== 0) {
        const s = Math.sqrt(c * c + d * d);
        rotation = Math.PI / 2 - Math.atan2(d, c);
        scaleX = delta / s;
        scaleY = s;
    }

    return {
        x: Number(e.toFixed(3)),
        y: Number(f.toFixed(3)),
        scaleX: Number(scaleX.toFixed(3)),
        scaleY: Number(scaleY.toFixed(3)),
        rotationDeg: Number((rotation * (180 / Math.PI)).toFixed(3))
    };
}

function extractAnimationData(htmlContent) {
    const data = {
        shapes: {},
        sprites: {},
        mainTimeline: null,
        timelines: []  // List of all timeline sprites with their frame counts
    };

    console.log("Extracting shapes...");
    // Regex to find shape functions
    const shapeRegex = /function (shape\d+)\([^)]*\)\s*\{([\s\S]*?)\n\}/g;
    let shapeMatch;
    
    while ((shapeMatch = shapeRegex.exec(htmlContent)) !== null) {
        const shapeId = shapeMatch[1];
        const body = shapeMatch[2];
        const elements =[];

        // Regex to find path string, color, and if it is filled or stroked
        const pathRegex = /pathData="([^"]+)"[\s\S]*?(fillStyle|strokeStyle)\s*=\s*tocolor\(ctrans\.apply\(\[([\d.,\s]+)\]\)\)[\s\S]*?drawPath\([^,]+,\s*[^,]+,\s*(true|false)\)/g;
        let pathMatch;
        
        while ((pathMatch = pathRegex.exec(body)) !== null) {
            elements.push({
                type: pathMatch[2] === 'fillStyle' ? 'fill' : 'stroke',
                color: pathMatch[3].split(',').map(Number), // [R, G, B, A]
                pathData: pathMatch[1]
            });
        }
        data.shapes[shapeId] = elements;
    }

    console.log(`Found ${Object.keys(data.shapes).length} shapes.`);
    console.log("Extracting sprites and timelines...");

    // Regex to find sprite functions
    const spriteRegex = /function (sprite\d+)\([^)]*\)\s*\{([\s\S]*?)\n\}/g;
    let spriteMatch;

    while ((spriteMatch = spriteRegex.exec(htmlContent)) !== null) {
        const spriteId = spriteMatch[1];
        const body = spriteMatch[2];
        const frames = {};

        // Find the case X: blocks inside the switch(frame)
        const caseRegex = /case (\d+):([\s\S]*?)break;/g;
        let caseMatch;
        let frameCount = 0;

        while ((caseMatch = caseRegex.exec(body)) !== null) {
            const frameNum = parseInt(caseMatch[1], 10);
            const caseBody = caseMatch[2];
            const instances =[];

            // Extract the place() commands
            const placeRegex = /place\("([^"]+)",[^\[]+\[([^\]]+)\]/g;
            let placeMatch;
            
            while ((placeMatch = placeRegex.exec(caseBody)) !== null) {
                const targetId = placeMatch[1];
                const rawMatrix = placeMatch[2].split(',').map(Number);
                
                instances.push({
                    targetId: targetId, // ID of the shape or nested sprite being placed
                    rawMatrix: rawMatrix,
                    transform: decomposeMatrix(rawMatrix) // Friendly X,Y, Rotation, Scale
                });
            }
            frames[frameNum] = instances;
            frameCount++;
        }
        
        data.sprites[spriteId] = frames;
    }

    // Now identify the main timeline: find the sprite that contains references to other sprites
    // This is likely the container sprite that wraps all other sprites
    let bestCandidate = data.mainTimeline; // fallback to current detection
    let maxSpriteReferences = 0;
    
    for (const spriteId in data.sprites) {
        let spriteRefCount = 0;
        const spriteFrames = data.sprites[spriteId];
        
        // Check all frames for sprite references
        for (const frameKey in spriteFrames) {
            const frame = spriteFrames[frameKey];
            for (const inst of frame) {
                // If the target is another sprite (not a shape), count it
                if (data.sprites[inst.targetId]) {
                    spriteRefCount++;
                }
            }
        }
        
        // The sprite that references the most other sprites is likely the main timeline
        if (spriteRefCount > maxSpriteReferences) {
            maxSpriteReferences = spriteRefCount;
            bestCandidate = spriteId;
        }
    }
    
    if (bestCandidate) {
        data.mainTimeline = bestCandidate;
    }
    
    // Build list of all timelines (sprites with multiple frames or containing sprite references)
    for (const spriteId in data.sprites) {
        const frameCount = Object.keys(data.sprites[spriteId]).length;
        // Include sprites with multiple frames OR containers with sprite references
        let isContainer = false;
        const spriteFrames = data.sprites[spriteId];
        for (const frameKey in spriteFrames) {
            const frame = spriteFrames[frameKey];
            for (const inst of frame) {
                if (data.sprites[inst.targetId]) {
                    isContainer = true;
                    break;
                }
            }
            if (isContainer) break;
        }
        
        if (frameCount > 1 || isContainer) {
            data.timelines.push({
                id: spriteId,
                frames: frameCount,
                isContainer: isContainer
            });
        }
    }
    
    // Sort timelines: main first, then by frame count descending
    data.timelines.sort((a, b) => {
        if (a.id === data.mainTimeline) return -1;
        if (b.id === data.mainTimeline) return 1;
        return b.frames - a.frames;
    });

    console.log(`Found ${Object.keys(data.sprites).length} sprites.`);
    console.log(`Identified main timeline: ${data.mainTimeline} (contains ${maxSpriteReferences} sprite references)`);
    console.log(`Available timelines: ${data.timelines.map(t => t.id + '(' + t.frames + 'fr)').join(', ')}`);

    return data;
}

// Execute Script
try {
    const htmlData = fs.readFileSync(INPUT_FILE, 'utf8');
    const extractedData = extractAnimationData(htmlData);
    
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(extractedData, null, 2));
    console.log(`\nSuccess! JSON saved to ${OUTPUT_FILE}`);
    
} catch (error) {
    console.error("Error reading or processing the file:", error.message);
}