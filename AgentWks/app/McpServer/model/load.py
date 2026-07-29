import os
from strands.models import BedrockModel

def load_model():
    """
    Loads Amazon Nova Pro model via Bedrock.
    """
    region = os.getenv("AWS_REGION", "us-east-1")
    return BedrockModel(
        model_id="us.amazon.nova-pro-v1:0",
        region_name=region
    )