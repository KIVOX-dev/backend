import requests
import json
import os
import time

BASE_PATH = "D:/mcq_data"

topics = [
    "Reasoning",
    "Logical",
    "Quantitative",
    "Data Interpretation"
]

# Ensure folder exists
os.makedirs(BASE_PATH, exist_ok=True)

# Generate MCQs
def generate_mcq(topic):
    prompt = f"""
Generate 5 aptitude MCQs on {topic}.

Return ONLY JSON array:
[
  {{
    "question": "...",
    "options": ["A","B","C","D"],
    "answer": "A",
    "explanation": "..."
  }}
]
"""

    response = requests.post(
        "http://localhost:11434/api/generate",
        json={
            "model": "phi3",   # ⚡ fast model
            "prompt": prompt,
            "stream": False
        }
    )

    text = response.json().get("response", "")

    print(f"\nRAW ({topic}):", text)

    # Extract JSON
    start = text.find("[")
    end = text.rfind("]")

    if start != -1 and end != -1:
        try:
            return json.loads(text[start:end+1])
        except:
            print("❌ JSON error")
            return []
    else:
        print("❌ No JSON found")
        return []

# Save topic-wise
def save_topic(topic, new_data):
    file_path = f"{BASE_PATH}/{topic.lower().replace(' ', '_')}.json"

    # Load existing
    if os.path.exists(file_path):
        with open(file_path, "r", encoding="utf-8") as f:
            try:
                old = json.load(f)
            except:
                old = []
    else:
        old = []

    old.extend(new_data)

    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(old, f, indent=2)

    print(f"✅ Saved {len(new_data)} to {file_path}")

# MAIN LOOP
for i in range(2000):  # test first
    topic = topics[i % len(topics)]

    print(f"\nBatch {i+1} | Topic: {topic}")

    data = generate_mcq(topic)

    if data:
        save_topic(topic, data)
    else:
        print("⚠️ Nothing saved")

    time.sleep(1)

print("\n🎉 Done! Check topic-wise JSON files")