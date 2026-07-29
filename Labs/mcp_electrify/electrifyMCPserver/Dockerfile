# Pull the AWS Lambda Web Adapter
FROM public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 AS adapter

# Standard Python base image
FROM public.ecr.aws/docker/library/python:3.12-slim

# Copy the adapter into the Lambda extensions directory
COPY --from=adapter /lambda-adapter /opt/extensions/lambda-adapter

# Lambda Web Adapter must health-check the same port FastMCP binds to.
# server.py hardcodes host="0.0.0.0", port=8000 — keep PORT in sync.
ENV PORT=8000
WORKDIR /var/task

# Install dependencies — this is what CodeZip was silently skipping.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy server code
COPY server.py .

# Boot the FastMCP server
CMD ["python", "server.py"]
