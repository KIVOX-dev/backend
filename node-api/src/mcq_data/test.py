import requests

res = requests.post(
    "http://localhost:11434/api/generate",
    json={
        "model": "deepseek-r1:8b",
        "prompt": "Say hello",
        "stream": False
    }
)

print(res.text)