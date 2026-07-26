import os
import uuid
import tempfile
from typing import Optional

from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager

# Deployed Memory Resource ID from CloudFormation deployment outputs
MEMORY_ID = os.getenv("MEMORY_ELECAGENTMEMORY_ID", "electrfyAssistant_elecAgentMemory-YOmmpz5DMZ")
REGION = os.getenv("AWS_REGION", "us-east-1")

def get_memory_session_manager(session_id: Optional[str], actor_id: str) -> Optional[AgentCoreMemorySessionManager]:
    # Use the system temp directory (/tmp) which is guaranteed writable in Lambda / AgentCore
    storage_dir = os.path.join(tempfile.gettempdir(), ".memory")
    os.makedirs(storage_dir, exist_ok=True)

    if not MEMORY_ID:
        return None

    # Synthesize session ID if absent
    session_id = session_id or uuid.uuid4().hex

    return AgentCoreMemorySessionManager(
        AgentCoreMemoryConfig(
            memory_id=MEMORY_ID,
            session_id=session_id,
            actor_id=actor_id,
        ),
        REGION
    )