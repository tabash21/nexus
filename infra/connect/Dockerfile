FROM confluentinc/cp-kafka-connect:7.9.2
ARG S3_CONNECTOR_VERSION=10.6.5
RUN confluent-hub install --no-prompt confluentinc/kafka-connect-s3:${S3_CONNECTOR_VERSION}
