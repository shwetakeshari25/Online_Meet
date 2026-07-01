// Mock NLP and AI Helper
// Can be extended with Groq or Gemini API keys in production

export const generateAgenda = async (goal, duration = 30) => {
    // Basic smart agenda generation
    const topics = [
        "1. Welcome & Introduction (5 mins)",
        `2. Discussion on core goal: "${goal}" (15 mins)`,
        "3. Address risks, blockers, and dependencies (5 mins)",
        "4. Review action items & next steps (5 mins)"
    ];
    
    return {
        goal,
        duration,
        agenda: topics.join('\n')
    };
};

export const generateMeetingSummary = async (transcript, participantsList) => {
    if (!transcript || transcript.length === 0) {
        return {
            summary: "No discussion was recorded during the meeting.",
            keyPoints: ["Meeting ended without speech transcription."],
            actionItems: [],
            score: 5.0,
            speakingInsights: {}
        };
    }

    // 1. Calculate Speaking Insights
    const speakCount = {};
    let totalMessages = transcript.length;
    
    transcript.forEach(t => {
        speakCount[t.sender] = (speakCount[t.sender] || 0) + 1;
    });

    const speakingInsights = {};
    for (const person in speakCount) {
        speakingInsights[person] = Math.round((speakCount[person] / totalMessages) * 100);
    }

    // 2. Extract Action Items (NLP simulation looking for action keywords)
    const actionItems = [];
    const actionKeywords = ['will', 'assign', 'need to', 'todo', 'task', 'responsible', 'should'];
    
    transcript.forEach(t => {
        const text = t.message.toLowerCase();
        const words = text.split(' ');
        
        // Check if any keyword matches
        const hasKeyword = actionKeywords.some(kw => text.includes(kw));
        if (hasKeyword && text.length > 10) {
            // Find possible assignee
            let assignee = t.sender;
            
            // Look for name references in the text
            participantsList.forEach(p => {
                if (p.name && p.name !== t.sender && text.includes(p.name.toLowerCase())) {
                    assignee = p.name;
                }
            });

            // Clean up text to create a task title
            let taskTitle = t.message;
            // Limit title length
            if (taskTitle.length > 80) {
                taskTitle = taskTitle.substring(0, 77) + "...";
            }

            actionItems.push({
                title: taskTitle,
                assignee: assignee,
                status: 'pending',
                dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0] // Default tomorrow
            });
        }
    });

    // Fallback if no action items found
    if (actionItems.length === 0) {
        actionItems.push({
            title: "Follow up on overall project status and feedback",
            assignee: participantsList[0]?.name || "Host",
            status: 'pending',
            dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        });
    }

    // 3. Generate Summary & Key Points
    const summaryList = [];
    const keyPoints = [];

    // Group transcripts by subject/speaker to make a smart summary
    const speakers = Object.keys(speakCount);
    if (speakers.length > 0) {
        summaryList.push(`The meeting was active with participation from ${speakers.join(', ')}.`);
        
        // Extract key topics
        const sentences = transcript.map(t => t.message);
        if (sentences.some(s => s.toLowerCase().includes('design') || s.toLowerCase().includes('ui') || s.toLowerCase().includes('ux'))) {
            keyPoints.push("Discussed UI/UX design mockups and layout elements.");
        }
        if (sentences.some(s => s.toLowerCase().includes('test') || s.toLowerCase().includes('bug') || s.toLowerCase().includes('qa'))) {
            keyPoints.push("Reviewed the testing phase progress and outstanding bug resolutions.");
        }
        if (sentences.some(s => s.toLowerCase().includes('delay') || s.toLowerCase().includes('risk') || s.toLowerCase().includes('block'))) {
            keyPoints.push("Identified potential delays and project risks that need mitigation.");
        }
        if (sentences.some(s => s.toLowerCase().includes('timeline') || s.toLowerCase().includes('roadmap') || s.toLowerCase().includes('schedule'))) {
            keyPoints.push("Aligned on project roadmap timeline and major delivery milestones.");
        }
        
        // General key points if empty
        if (keyPoints.length === 0) {
            keyPoints.push("Reviewed general progress update and daily tasks.");
            keyPoints.push("Synced on team workflows and next actionable items.");
        }
    } else {
        summaryList.push("A brief discussion took place regarding open tasks.");
        keyPoints.push("General update shared by participants.");
    }

    summaryList.push(`A total of ${totalMessages} conversation segments were recorded and analyzed.`);
    
    // 4. Calculate Meeting Score (based on participation balance, toggle logs, transcript length)
    // Score starts at 8.0.
    // If participation is balanced, score goes up.
    // If there is very high camera/mic toggle action, or low speech count, it might lower/raise it.
    let score = 8.0;
    const speakerPercentages = Object.values(speakingInsights);
    if (speakerPercentages.length > 1) {
        const maxPct = Math.max(...speakerPercentages);
        const minPct = Math.min(...speakerPercentages);
        const spread = maxPct - minPct;
        
        // Balanced meeting is where spread is smaller (everybody speaks)
        if (spread < 20) {
            score += 1.0; // Excellent balance
        } else if (spread > 50) {
            score -= 1.0; // One person dominated
        }
    }
    
    // Length modifier
    if (totalMessages > 15) {
        score += 0.5;
    } else if (totalMessages < 5) {
        score -= 0.5;
    }

    score = Math.max(1.0, Math.min(10.0, Math.round(score * 10) / 10));

    return {
        summary: summaryList.join(' '),
        keyPoints,
        actionItems,
        score,
        speakingInsights
    };
};

export const translateText = async (text, targetLang) => {
    // Simulates standard translation
    // In a real application, you can use Google Translate or an LLM
    const langMap = {
        'es': {
            'good morning': 'buenos días',
            'hello': 'hola',
            'how are you': 'cómo estás',
            'project update': 'actualización del proyecto',
            'development is on track': 'el desarrollo va por buen camino',
            'testing is in progress': 'las pruebas están en curso',
            'delays': 'retrasos',
            'thank you': 'gracias',
            'goodbye': 'adiós'
        },
        'hi': {
            'good morning': 'शुभ प्रभात',
            'hello': 'नमस्ते',
            'how are you': 'आप कैसे हैं',
            'project update': 'परियोजना अद्यतन',
            'development is on track': 'विकास सही दिशा में है',
            'testing is in progress': 'परीक्षण प्रगति पर है',
            'delays': 'देरी',
            'thank you': 'धन्यवाद',
            'goodbye': 'अलविदा'
        },
        'fr': {
            'good morning': 'bonjour',
            'hello': 'salut',
            'how are you': 'comment ça va',
            'project update': 'mise à jour du projet',
            'development is on track': 'le développement est sur la bonne voie',
            'testing is in progress': 'les tests sont en cours',
            'delays': 'retards',
            'thank you': 'merci',
            'goodbye': 'au revoir'
        }
    };

    const target = targetLang.toLowerCase();
    const cleanText = text.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"");

    if (langMap[target] && langMap[target][cleanText]) {
        return langMap[target][cleanText];
    }

    // Default simulated suffix if not found in pre-coded translations
    if (target === 'es') return `[Traducido] ${text}`;
    if (target === 'hi') return `[अनुवादित] ${text}`;
    if (target === 'fr') return `[Traduit] ${text}`;
    
    return `[Translated to ${targetLang}] ${text}`;
};
