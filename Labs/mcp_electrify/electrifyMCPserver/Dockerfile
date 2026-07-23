# Pull the AWS Lambda Web Adapter
FROM public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 AS adapter

# Standard Python base image
FROM public.ecr.aws/docker/library/python:3.12-slim

# Copy the adapter into the Lambda extensions directory
COPY --from=adapter /lambda-adapter /opt/extensions/lambda-adapter

# Set up the environment
ENV PORT=8080
WORKDIR /var/task

# Install your dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy your code
COPY server.py .

# Boot the server
CMD ["python", "server.py"]