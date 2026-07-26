import os
import json
from decimal import Decimal
import boto3
from boto3.dynamodb.conditions import Key
from mcp.server.fastmcp import FastMCP

# Initialize the MCP Server
mcp = FastMCP("Electrify_DynamoDB_Server")

# Configure AWS and DynamoDB
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
# Amplify Gen2 generates dynamic table names, passed via environment variable
TABLE_NAME = os.environ.get("DYNAMODB_TABLE_NAME", "ConsumptionRecord-lnnvd64opbhfxhyltf4knx6dxm-NONE")
GSI_NAME = "consumptionRecordsByCustomerIdAndMonthYear" 

dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
table = dynamodb.Table(TABLE_NAME)

# Helper to handle DynamoDB Decimals for JSON serialization
def serialize_item(item):
    for key, value in item.items():
        if isinstance(value, Decimal):
            item[key] = int(value) if value % 1 == 0 else float(value)
    return item

# Register the Tool via Decorator
@mcp.tool()
def get_customer_bills(customerId: str, limit: int = 12) -> str:
    """
    Retrieves the historical energy consumption bills for a specific customer from DynamoDB.
    
    Args:
        customerId: The exact, hyphenated UUID string of the customer.
        limit: The maximum number of monthly bills to retrieve. Default is 12.
    """
    customerId = customerId.strip()
    if not customerId:
        return json.dumps({"error": "customerId is required."})

    try:
        response = table.query(
            IndexName=GSI_NAME,
            KeyConditionExpression=Key("customerId").eq(customerId),
            ScanIndexForward=False, 
            Limit=limit,
        )
        items = response.get("Items", [])
        
        if not items:
            return json.dumps({"message": f"No records found for customerId: {customerId}."})
            
        serialized_items = [serialize_item(i) for i in items]
        return json.dumps({"items": serialized_items}, indent=2)
        
    except Exception as exc:
        return json.dumps({"error": f"DynamoDB query failed: {str(exc)}"})

if __name__ == "__main__":
    mcp.run(transport='stdio')