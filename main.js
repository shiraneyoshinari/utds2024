const { nowInSec, SkyWayAuthToken, SkyWayContext, SkyWayRoom, SkyWayStreamFactory, uuidV4 } = skyway_room;

// STEP1: SkyWayAuthTokenの生成
const appId = '837efda0-03ab-4c29-9c8b-42778d07794d'
const secretKey = 'XqDfCiVmlaYshDv5TJIH3OTQGcojVFg/K0fij21BbOA='
const token = new SkyWayAuthToken({
  jti: uuidV4(),
  iat: nowInSec(),
  exp: nowInSec() + 60 * 60 * 24,
  scope: {
    app: {
      id: appId,
      turn: true,
      actions: ['read'],
      channels: [
        {
          id: '*',
          name: '*',
          actions: ['write'],
          members: [
            {
              id: '*',
              name: '*',
              actions: ['write'],
              publication: {
                actions: ['write'],
              },
              subscription: {
                actions: ['write'],
              },
            },
          ],
          sfuBots: [
            {
              actions: ['write'],
              forwardings: [
                {
                  actions: ['write'],
                },
              ],
            },
          ],
        },
      ],
    },
  },
}).encode(secretKey);

(async () => {
  
  // 宣言・初期値の代入
  const localAudio = document.getElementById('local-audio');
  const localVideo = document.getElementById('local-video');
  const roomNameInput = document.getElementById('room-name');
  const joinButton = document.getElementById('join-button');
  const localMuteButton = document.getElementById('local-mute-buton');
  const leaveButton = document.getElementById('leave-button');
  const myId = document.getElementById('my-id');
  const remoteId = document.getElementById('remote-id');
  const remoteVideo = document.getElementById('remote-video');
  const remoteAudio = document.getElementById('remote-audio');
  const buttonArea = document.querySelector('#button-area');
  const maxNumberParticipants = 2;
  let isJoined = false;
  let isMuted = false;
  let selectBox = null;
  leaveButton.disabled = true;
  
  // STEP2: 自分自身のカメラとマイクを取得して描画
try {
  const { audio, video } = await SkyWayStreamFactory.createMicrophoneAudioAndCameraStream({
    video: { facingMode: { exact: 'environment' } },
  });
  audio.attach(localAudio);
  video.attach(localVideo);
} catch (error) {
  console.error('カメラデバイスの取得に失敗しました: ', error);
}

  
  // Room作成/参加ボタンがクリックされた場合の処理
  joinButton.onclick = async () => {
  
    // Room名が空白の場合は処理終了
    if (roomNameInput.value === '') return;

    // STEP3: SFURoomの作成（すでに作成中の場合はその情報を取得）
    const context = await SkyWayContext.Create(token);
    const room = await SkyWayRoom.FindOrCreate(context, {
      type: 'sfu',
      name: roomNameInput.value,
    });

    
    // アプリ仕様上、Roomの最大参加人数を2名に制限する
    if (room.members.length > maxNumberParticipants){
      console.log('最大参加人数(' + maxNumberParticipants +')を超えています');
      room.dispose();
      return;
    }
    
    // STEP4: Roomに参加し自分のIDを画面に表示
    let me = await room.join();
    myId.textContent = me.id;
    
    // UIの初期化
    isJoined　= true;
    localMuteButton.disabled = false;
    leaveButton.disabled = false;
    
    // STEP5: 自分の音声と映像をpublishする
    // 映像はサイマルキャストで3パターン指定する
    const localAudioPublication = await me.publish(audio);
    const localVideoPublication = await me.publish(video, {
      encodings: [
        { maxBitrate: 80_000, id: 'low' },
        { maxBitrate: 500_000, id: 'middle' },
        { maxBitrate: 5000_000, id: 'high' },
      ],
    });

    // STEP6: 音声・映像の受信処理
    // STEP6-1: 音声・映像をsubscribeした時の処理
    const subscribeAndAttach = (publication) => {
      console.log(publication.id);
      // 自分の音声・映像だった場合は処理を終了
      if (publication.publisher.id === me.id) return;

      // 相手のIDを表示
      remoteId.textContent = publication.publisher.id;

      // 音声・映像の受信および再生用ボタンを生成
      if(buttonArea.childElementCount === 3) buttonArea.innerHTML='';
      const subscribeButton = document.createElement('button');
      subscribeButton.textContent = publication.contentType;
      buttonArea.appendChild(subscribeButton);
      
      // サイマルキャストの解像度選択用セレクトボックスを生成
      if(publication.contentType === 'video'){
        const selectData = [
          { value: 'low', label: '低画質' },
          { value: 'middle', label: '中画質' },
          { value: 'high', label: '高画質' }
        ];
        selectBox = document.createElement('select');
        for (let i = 0; i < selectData.length; i++) {
          let option = document.createElement('option');
          option.value = selectData[i].value;
          option.text = selectData[i].label;
          selectBox.appendChild(option);
        }
        buttonArea.appendChild(selectBox);
      }
      
      // 取得した音声・映像を受信
      subscribeButton.onclick = async () => {
        const { stream, subscription } = await me.subscribe(publication.id);   
        switch (stream.track.kind) {
          case 'video':
            stream.attach(remoteVideo);
            // サイマルキャスによる映像の選択
            subscription.changePreferredEncoding('low');
            selectBox.addEventListener('change', function(){
              switch(this.value) {
                case 'low':
                  subscription.changePreferredEncoding('low');
                  break;
                case 'middle':
                  subscription.changePreferredEncoding('middle');
                  break;
                case 'high':
                  subscription.changePreferredEncoding('high');
                  break;
                default:
                  return;
              }
            });

            // STEP7-2: 映像・音声OFFボタンをクリックした時の処理(受信側の処理)
            publication.onDisabled.add(() => remoteVideo.load());

            break;
          case 'audio':
            stream.attach(remoteAudio);
            break;
          default:
            return;
        }
        subscribeButton.disabled = true;
      }
    }

    // STEP6-2: Room入室時、すでにpublishされている音声・映像を受信するための処理
    room.publications.forEach(subscribeAndAttach);
    
    // STEP6-3: Room入室後に他のメンバーによってpublishされた音声・映像を受信するための処理
    room.onStreamPublished.add((e) => subscribeAndAttach(e.publication));
    
    // STEP7: 映像・音声OFFボタンをクリックした時の処理
    // STEP7-1: 映像・音声OFFボタンをクリックした時の処理(送信側の処理)
    localMuteButton.onclick = async () => {
      if(isMuted){
        await localAudioPublication.enable();
        await localVideoPublication.enable();
        isMuted = false;
        localMuteButton.textContent = '映像・音声OFF';
      }else{
        await localAudioPublication.disable();
        await localVideoPublication.disable();
        isMuted = true;
        localMuteButton.textContent = '映像・音声 ON';
      }
    }

    
    // STEP8: Roomを閉じるボタンをクリックした時の処理
    leaveButton.onclick = async () => {
      await me.leave();
      await room.close();
      closeRoom();
      return;
    }

    // Roomが閉じられた際のUI処理
    const closeRoom = () => {
      buttonArea.innerHTML = '';
      remoteId.textContent = '';
      myId.textContent = '';
      localMuteButton.disabled = true;
      leaveButton.disabled = true;
    };
  
    // Roomからメンバーが抜けた時の処理
    room.onMemberLeft.add(() => closeRoom());

  }
  
})();
