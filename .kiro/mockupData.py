import uuid
import boto3
import random
import datetime
from decimal import Decimal

# 1. Initialize DynamoDB Resource
dynamodb = boto3.resource('dynamodb', region_name='us-east-1')
TABLE_NAME = 'ConsumptionRecord-o6wktlvbrvgydojj56vajcbiwy-NONE'
table = dynamodb.Table(TABLE_NAME)

# ---------------------------------------------------------
# 2. UPDATE THIS VALUE WITH YOUR ACTUAL COGNITO USER SUB ID
# ---------------------------------------------------------
CUSTOMER_ID = "44580488-7091-70d3-aa31-0a6b51e65b74"

def seed_database():
    """Generates 12 months of random energy data and pushes it to DynamoDB."""
    if CUSTOMER_ID == "YOUR_COGNITO_USER_SUB_ID_HERE":
        print("[ERROR] Please update the CUSTOMER_ID variable with your actual Cognito user ID.")
        return

    # Establish a baseline date to generate the last 12 months
    # We will generate data from August 2025 to July 2026
    start_date = datetime.date(2025, 8, 1)
    
    for i in range(12):
        # Calculate the sequential month and year
        current_month = start_date.month + i
        year_offset = (current_month - 1) // 12
        month = (current_month - 1) % 12 + 1
        year = start_date.year + year_offset
        
        month_year = f"{year}-{month:02d}"
        dummy_date = f"{year}-{month:02d}-15"
        
        # Generate random consumption and bill data
        kwh_usage = round(random.uniform(200.0, 500.0), 2)
        statement_amount = round(kwh_usage * 0.15, 2)  # Assuming a mock rate of $0.15 per kWh
        
        # AWS AppSync / DynamoDB expects exact attributes including system timestamps
        current_timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
        
        # 3. Map Data to Amplify Model Expectations
        item = {
            "id": str(uuid.uuid4()),
            "customerId": CUSTOMER_ID,  # 👈 AppSync now uses this for the owner check!
            "monthYear": month_year,
            "date": dummy_date,
            "kwhUsage": Decimal(str(kwh_usage)),
            "statementAmount": Decimal(str(statement_amount)),
            "ratePlan": random.choice(["Day Rate", "Evening Rate", "Night Rate"]),
            "__typename": "ConsumptionRecord",
            "createdAt": current_timestamp,
            "updatedAt": current_timestamp
        }
        
        # 4. Execute the DB Push
        try:
            table.put_item(Item=item)
            print(f"[SUCCESS] Inserted record for monthYear: {month_year} | {kwh_usage} kWh | ${statement_amount}")
        except Exception as e:
            print(f"[ERROR] Failed to insert {month_year}: {str(e)}")

if __name__ == "__main__":
    print("Starting DynamoDB Database Seeding...")
    seed_database()
    print("Seeding Complete!")