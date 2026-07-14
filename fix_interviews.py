import os
import re

with open("app/api/v1/interviews.py", "r") as f:
    content = f.read()

replacement = """
@router.post("/generate", response_model=list[dict])
def generate_questions(role: str, company: str = "general", current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    \"\"\"
    Generates 10 random questions for the given role and company using Groq LLM.
    \"\"\"
    import os
    import json
    from groq import Groq
    from fastapi import HTTPException
    
    groq_api_key = os.getenv("GROQ_API_KEY")
    if not groq_api_key:
        import random
        question_pool = [
            "What are the key differences between React and Angular?",
            "Explain the concept of closures in JavaScript.",
            "How would you optimize a slow-performing database query?",
            "Describe a time you had to resolve a conflict within your team.",
            "What is the difference between TCP and UDP?"
        ]
        selected_questions = random.sample(question_pool * 2, 10)
        return [{"id": i + 1, "text": f"[{company.upper()} - {role.upper()}] {q}", "time_limit_seconds": 60, "type": "technical"} for i, q in enumerate(selected_questions)]

    try:
        client = Groq(api_key=groq_api_key)
        
        prompt = f\"\"\"
        You are an expert technical interviewer at {company} hiring for a {role} position.
        Generate exactly 10 interview questions for this specific role and company. 
        Make them realistic, challenging, and a mix of technical (7) and behavioral (3) questions.
        Return the result as a raw JSON object with a single key "questions" containing a list of strings.
        Do not include markdown blocks or any other text outside the JSON.
        \"\"\"

        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=1024,
            response_format={"type": "json_object"}
        )

        result_text = completion.choices[0].message.content
        data = json.loads(result_text)
        generated_questions = data.get("questions", [])
        
        # Ensure we have exactly 10 questions
        if not generated_questions or len(generated_questions) < 10:
            raise ValueError("LLM did not return enough questions")
            
        formatted_questions = []
        for i, q in enumerate(generated_questions[:10]):
            formatted_questions.append({
                "id": i + 1,
                "text": q,
                "time_limit_seconds": 60,
                "type": "technical" if i < 7 else "behavioral"
            })
            
        return formatted_questions
    except Exception as e:
        print(f"Failed to generate questions with AI: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate questions: {str(e)}")
"""

# Regex replacement
new_content = re.sub(
    r'@router\.post\("/generate".*?(?=\n\s*$|\Z)', 
    replacement.strip(), 
    content, 
    flags=re.DOTALL
)

with open("app/api/v1/interviews.py", "w") as f:
    f.write(new_content)
