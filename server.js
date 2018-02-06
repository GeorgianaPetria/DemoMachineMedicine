var express = require('express');
var crypto = require('crypto');
var path = require('path');
var AWS = require('aws-sdk');
var bodyParser = require('body-parser');

var s3 = require('./s3');

var s3Config = {
  accessKey: process.env.S3_ACCESS_KEY,
  secretKey: process.env.S3_SECRET_KEY,
  bucket: process.env.S3_BUCKET,
  region: process.env.S3_REGION
};

AWS.config.region = process.env.REGION

var sns = new AWS.SNS();
var ddb = new AWS.DynamoDB();
var sqs = new AWS.SQS({apiVersion: '2012-11-05'});

var ddbTable =  process.env.ANALYSIS_REQUEST_TABLE;
var snsTopic =  process.env.NEW_ANALYSIS_REQUEST_TOPIC;
var sqsUrl = process.env.NEW_VIDEO_UPLOADED_QUEUE;

var app = express();

app.use(express.static(__dirname + '/public'));
app.use(express.static(__dirname + '/views'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/s3_credentials', function(request, response) {
  if (request.query.filename) {
    var filename =
      crypto.randomBytes(16).toString('hex') +
      path.extname(request.query.filename);
    response.json(s3.s3Credentials(s3Config, {filename: filename, contentType: request.query.content_type}));
  } else {
    response.status(400).send('filename is required');
  }
});

app.post('/analyse', function(request, response) {
  if (request.body.email && request.body.location) {
    var item = {
      'name': {'S': request.body.name},
      'email': {'S': request.body.email},
      'filename': {'S': request.body.filename},
      'location': {'S': request.body.location}
    };

    ddb.putItem({
      'TableName': ddbTable,
      'Item': item,
      'Expected': { location: { Exists: false } }        
    }, function(err, data) {
      console.log("alo");
      if (err) {
        var returnStatus = 500;

        if (err.code === 'ConditionalCheckFailedException') {
          returnStatus = 409;
        }

        response.status(returnStatus).end();
          console.log('DDB Error: ' + err);
      } else {
        sns.publish({
          'Message': 'Name: ' + request.body.name + "\r\nEmail: " + request.body.email
              + "\r\nFilename: " + request.body.filename
              + "\r\nLocation: " + request.body.location,
                  'Subject': 'New analysis request!!!',
                  'TopicArn': snsTopic
        }, function(err, data) {
              if (err) {
                response.status(500).end();
                console.log('SNS Error: ' + err);
              } else {
                response.status(201).end();
              }
        });

        var params = {
          DelaySeconds: 10,
          MessageAttributes: {
            "name": {
              DataType: "String",
              StringValue: request.body.name
            },
            "email": {
              DataType: "String",
              StringValue: request.body.email
            },
            "filename": {
              DataType: "String",
              StringValue: request.body.filename
            },
            "location": {
              DataType: "String",
              StringValue: request.body.location
            }
          },
          MessageBody: "Information about video analysis request.",
          QueueUrl: sqsUrl
        };

        sqs.sendMessage(params, function(err, data) {
          if (err) {
            console.log("Error", err);
          } else {
            console.log("Success", data.MessageId);
          }
        });

      }
    });
  } else {
    response.status(400).send('Name, email and at least one file are required');
  }
});

app.set('port', (process.env.PORT || 5000));

var server = app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});
