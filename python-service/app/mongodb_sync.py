import os

import certifi
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()

MONGO_URI = os.getenv("MONGODB_URI")
MONGO_DB_NAME = os.getenv("MONGODB_DB_NAME", "upscaler_ai")

# Synchronous client for the existing synchronous routes.
#
# Pool sizing matters here: FastAPI runs `def` endpoints in a threadpool
# (40 threads by default), and each concurrent request checks out its own
# connection. A pool smaller than the threadpool makes requests queue behind
# each other, which reads as "the API is slow" even when the queries are fast.
#
# The timeouts are explicit so a network blip surfaces as a fast error rather
# than a request that hangs for the driver's 30s default.
client = MongoClient(
    MONGO_URI,
    tlsCAFile=certifi.where(),
    maxPoolSize=int(os.getenv("MONGO_POOL_MAX", "50")),
    minPoolSize=int(os.getenv("MONGO_POOL_MIN", "5")),
    # Keep warm sockets so we don't pay TLS handshake cost on every burst.
    maxIdleTimeMS=60_000,
    serverSelectionTimeoutMS=8_000,
    connectTimeoutMS=8_000,
    socketTimeoutMS=20_000,
    retryWrites=True,
    retryReads=True,
    # zlib ships with Python, so this needs no extra dependency. Wire-protocol
    # compression is a real win against a remote Atlas cluster.
    compressors="zlib",
    appname="upscaler-ai-api",
)
mongo_db = client[MONGO_DB_NAME]


def get_sync_mongo_db():
    try:
        yield mongo_db
    finally:
        pass
