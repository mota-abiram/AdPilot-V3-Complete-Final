import requests
import json
import os

TOKEN_URL = "https://oauth2.googleapis.com/token"
client_id = "YOUR_GOOGLE_CLIENT_ID"
client_secret = "YOUR_GOOGLE_CLIENT_SECRET"
refresh_token = "YOUR_GOOGLE_REFRESH_TOKEN"

payload = {
    "client_id": client_id,
    "client_secret": client_secret,
    "refresh_token": refresh_token,
    "grant_type": "refresh_token",
}

print("Testing Google Token Refresh...")
resp = requests.post(TOKEN_URL, data=payload)
print(f"Status: {resp.status_code}")
print(f"Response: {resp.text}")
