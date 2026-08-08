import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google import genai
from dotenv import load_dotenv

app = FastAPI(title="Word Definer AI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Load variables from .env file into environment
load_dotenv()
app = FastAPI(title="Word Definer AI Backend")

# Initialize Gemini Client
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
client = genai.Client(api_key=GEMINI_API_KEY)

# Using one of the modern models from your list
MODEL_ID = "gemini-3.5-flash-lite"

class AIExplainRequest(BaseModel):
    target_text: str
    surrounding_context: str
    mode: str = "contextual_definition"

@app.post("/explain")
async def explain_in_context(req: AIExplainRequest):
    if not req.target_text.strip():
        raise HTTPException(status_code=400, detail="Target text cannot be empty.")

    prompt = f"""
    You are a context-aware reading assistant. 
    Do NOT just provide a generic dictionary definition. 

    Explain specifically how the word/phrase "{req.target_text}" is used in this exact passage and what it implies in this specific context:

    Passage: "{req.surrounding_context}"

    Provide a concise 2-sentence explanation explaining its exact contextual meaning in this sentence.
    """

    try:
        response = client.models.generate_content(
            model=MODEL_ID,
            contents=prompt,
        )
        return {"explanation": response.text.strip()}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Gemini API Error: {str(e)}"
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)