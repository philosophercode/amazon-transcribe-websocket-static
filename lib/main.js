const audioUtils = require('./audioUtils');  // for encoding audio data as PCM
const crypto = require('crypto'); // tot sign our pre-signed URL
const v4 = require('./aws-signature-v4'); // to generate our pre-signed URL
const marshaller = require("@aws-sdk/eventstream-marshaller"); // for converting binary event stream messages to and from JSON
const util_utf8_node = require("@aws-sdk/util-utf8-node"); // utilities for encoding and decoding UTF8
const mic = require('microphone-stream'); // collect microphone input as a stream of raw bytes

import WordCloud from 'wordcloud';
// our converter between binary event streams messages and JSON
const eventStreamMarshaller = new marshaller.EventStreamMarshaller(util_utf8_node.toUtf8, util_utf8_node.fromUtf8);

// our global variables for managing state
let languageCode = "en-US";
let region = 'us-east-1';
let sampleRate = 44100;
let transcription = "";
let socket;
let micStream;
let socketError = false;
let transcribeException = false;
let data;


function countWords(str) {
    //Edge case: an empty array
    if (str.length === 0) {
        return [];
    }
    var output = {};
    var strArr = str.split(/[ .?!,*'"]/);
    //A loop
    for (var i = 0; i < strArr.length; i++) {
        var word = strArr[i];
        if (output[word] === undefined) {
            output[word] = 1;
        } else {
            output[word] += 1;
        }

    }
    const wordFreq = Object.entries(output);
    console.log('Object.entries(output)', wordFreq)

    return wordFreq;
}

function wordFrequency(txt) {
    var wordArray = txt.split(/[ .?!,*'"]/);
    var newArray = [], wordObj;
    wordArray.forEach(function (word) {
        wordObj = newArray.filter(function (w) {
            return w.text == word;
        });
        if (wordObj.length) {
            wordObj[0].size += 1;
        } else {
            newArray.push({ text: word, size: 1 });
        }
    });
    return newArray;
}

// check to see if the browser allows mic access
if (!window.navigator.mediaDevices.getUserMedia) {
    // Use our helper method to show an error on the page
    showError('We support the latest versions of Chrome, Firefox, Safari, and Edge. Update your browser and try your request again.');

    // maintain enabled/distabled state for the start and stop buttons
    toggleStartStop();
}

$('#start-button').click(function () {
    $('#error').hide(); // hide any existing errors
    toggleStartStop(true); // disable start and enable stop button

    // set the language and region from the dropdowns
    // setLanguage();
    // setRegion();

    // first we get the microphone input from the browser (as a promise)...
    window.navigator.mediaDevices.getUserMedia({
        video: false,
        audio: true
    })
        // ...then we convert the mic stream to binary event stream messages when the promise resolves 
        .then(streamAudioToWebSocket)
        .catch(function (error) {
            showError('There was an error streaming your audio to Amazon Transcribe. Please try again.');
            toggleStartStop();
        });
});

let streamAudioToWebSocket = function (userMediaStream) {
    //let's get the mic input from the browser, via the microphone-stream module
    micStream = new mic();
    micStream.setStream(userMediaStream);

    // Pre-signed URLs are a way to authenticate a request (or WebSocket connection, in this case)
    // via Query Parameters. Learn more: https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
    let url = createPresignedUrl();

    //open up our WebSocket connection
    socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";

    // when we get audio data from the mic, send it to the WebSocket if possible
    socket.onopen = function () {
        micStream.on('data', function (rawAudioChunk) {
            // the audio stream is raw audio bytes. Transcribe expects PCM with additional metadata, encoded as binary
            let binary = convertAudioToBinaryMessage(rawAudioChunk);

            if (socket.OPEN)
                socket.send(binary);
        }
        )
    };

    // handle messages, errors, and close events
    wireSocketEvents();
}

// function setLanguage() {
//     languageCode = $('#language').find(':selected').val();
//     if (languageCode == "en-US" || languageCode == "es-US")
//         sampleRate = 44100;
//     else
//         sampleRate = 8000;
// }

// function setRegion() {
//     region = $('#region').find(':selected').val();
// }

function wireSocketEvents() {
    // handle inbound messages from Amazon Transcribe
    socket.onmessage = function (message) {
        //convert the binary event stream message to JSON
        let messageWrapper = eventStreamMarshaller.unmarshall(Buffer(message.data));
        let messageBody = JSON.parse(String.fromCharCode.apply(String, messageWrapper.body));
        if (messageWrapper.headers[":message-type"].value === "event") {
            handleEventStreamMessage(messageBody);
        }
        else {
            transcribeException = true;
            showError(messageBody.Message);
            toggleStartStop();
        }
    };

    socket.onerror = function () {
        socketError = true;
        showError('WebSocket connection error. Try again.');
        toggleStartStop();
    };

    socket.onclose = function (closeEvent) {
        micStream.stop();

        // the close event immediately follows the error event; only handle one.
        if (!socketError && !transcribeException) {
            if (closeEvent.code != 1000) {
                showError('</i><strong>Streaming Exception</strong><br>' + closeEvent.reason);
            }
            toggleStartStop();
        }
    };
}

let handleEventStreamMessage = function (messageJson) {
    let results = messageJson.Transcript.Results;

    if (results.length > 0) {
        if (results[0].Alternatives.length > 0) {
            let transcript = results[0].Alternatives[0].Transcript;

            // fix encoding for accented characters
            transcript = decodeURIComponent(escape(transcript));

            // update the textarea with the latest result
            // $('#transcript').val(transcription + transcript + "\n");

            // $('#all-text').html(transcription + transcript);
            // if this transcript segment is final, add it to the overall transcription
            if (!results[0].IsPartial) {
                //scroll the textarea down
                // $('#transcript').scrollTop($('#transcript')[0].scrollHeight);

                transcription += transcript;
            }
            console.log('transcription', transcription)
            // var divEl = document.getElementById('surrounding-div');
            // var canvasEl = document.getElementById('word-cloud');

            // canvasEl.height = divEl.offsetHeight;
            // canvasEl.width = divEl.offsetWidth;
            // console.log('transcript', transcript)

            // data =+ transcription;
            // $('#all-text').html(data);


            $('#all-text').html(transcription);
            const wordFreq = countWords(transcription);
            // const wordFreq = wordFrequency(transcription).sort((a,b)=>{return a.size<b.size});
            console.log('wordFreq', wordFreq)
            const wordFreqStr = JSON.stringify(wordFreq.slice(0, 20)).split("],").join("]<br/>");

            $('#word-freq').html(wordFreqStr);
            WordCloud(document.getElementById('word-cloud'), {
                list: wordFreq,
                // size: 2,
                backgroundColor: 'white',
                drawOutOfBound: false,
                gridSize: 32
            });
            // document.write(JSON.stringify(wordFrequency(transcription).sort((a,b)=>{return a.size<b.size})).split("},").join("}<br/>"));
        }
    }
}

let closeSocket = function () {
    if (socket.OPEN) {
        micStream.stop();

        // Send an empty frame so that Transcribe initiates a closure of the WebSocket after submitting all transcripts
        let emptyMessage = getAudioEventMessage(Buffer.from(new Buffer([])));
        let emptyBuffer = eventStreamMarshaller.marshall(emptyMessage);
        socket.send(emptyBuffer);
    }
}

$('#stop-button').click(function () {
    closeSocket();
    toggleStartStop();
});

$('#reset-button').click(function () {
    $('#transcript').val('');
    transcription = '';
});

function toggleStartStop(disableStart = false) {
    $('#start-button').prop('disabled', disableStart);
    $('#stop-button').attr("disabled", !disableStart);
}

function showError(message) {
    $('#error').html('<i class="fa fa-times-circle"></i> ' + message);
    $('#error').show();
}

function convertAudioToBinaryMessage(audioChunk) {
    let raw = mic.toRaw(audioChunk);

    if (raw == null)
        return;

    // downsample and convert the raw audio bytes to PCM
    let downsampledBuffer = audioUtils.downsampleBuffer(raw, sampleRate);
    let pcmEncodedBuffer = audioUtils.pcmEncode(downsampledBuffer);

    // add the right JSON headers and structure to the message
    let audioEventMessage = getAudioEventMessage(Buffer.from(pcmEncodedBuffer));

    //convert the JSON object + headers into a binary event stream message
    let binary = eventStreamMarshaller.marshall(audioEventMessage);

    return binary;
}

function getAudioEventMessage(buffer) {
    // wrap the audio data in a JSON envelope
    return {
        headers: {
            ':message-type': {
                type: 'string',
                value: 'event'
            },
            ':event-type': {
                type: 'string',
                value: 'AudioEvent'
            }
        },
        body: buffer
    };
}

function createPresignedUrl() {
    let endpoint = "transcribestreaming." + region + ".amazonaws.com:8443";

    // get a preauthenticated URL that we can use to establish our WebSocket
    return v4.createPresignedURL(
        'GET',
        endpoint,
        '/stream-transcription-websocket',
        'transcribe',
        crypto.createHash('sha256').update('', 'utf8').digest('hex'), {
        'key': 'AKIA5CS7PD3AHG2PP5ZG',
        // 'key': $('#access_id').val(),
        'secret': '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',
        // 'secret': $('#secret_key').val(),
        'sessionToken': "",
        'protocol': 'wss',
        'expires': 15,
        'region': region,
        'query': "language-code=" + languageCode + "&media-encoding=pcm&sample-rate=" + sampleRate
    }
    );
}
