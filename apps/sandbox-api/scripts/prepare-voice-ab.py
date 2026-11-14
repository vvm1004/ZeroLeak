"""Build a bounded Vietnamese A/B set from checked public/clone sources and authored TTS.
Raw audio stays outside Git. This does not create genuine human scam recordings.
"""
import argparse,hashlib,json,random,shutil,subprocess,wave,array,math
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--acoustic-manifest',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
p.add_argument('--seed',type=int,default=20261113);a=p.parse_args()
root=a.output.resolve();source=a.acoustic_manifest.resolve();base=source.parent
if root.exists() and any(root.iterdir()):p.error('Use a new/empty directory')
(root/'audio').mkdir(parents=True);(root/'raw').mkdir()
data=json.loads(source.read_text())['cases'];rng=random.Random(a.seed);cases=[];selected=[]
sha=lambda x:hashlib.sha256(x).hexdigest()
conditions=['clean','phone8k','room_noise15db']
# Calibration/test speaker partitions come from the existing public-data protocol.
for split,cohort,family,count in [('dev','v3-new','VieNeu-Nano-Clone',2),('test','v3-turbo-audit','VieNeu-Turbo-Clone',6)]:
 candidates=[x for x in data if x['family']==family and x['cohort']==cohort and x['condition']=='clean' and x['split']==('calibration' if split=='dev' else 'test')]
 rng.shuffle(candidates)
 # Visit distinct speakers first; a sixth test origin repeats one of five speakers.
 candidates.sort(key=lambda x:x['speakerId']);by_speaker={}
 for x in candidates:by_speaker.setdefault(x['speakerId'],[]).append(x)
 ordered=[]
 while any(by_speaker.values()):
  for key in sorted(by_speaker):
   if by_speaker[key]:ordered.append(by_speaker[key].pop())
 for original in ordered[:count]:
  group=original['originId']
  for label in ['human','synthetic']:
   for condition in conditions:
    found=[x for x in data if x['originId']==group and x['cohort']==cohort and x['label']==label and x['condition']==condition]
    if len(found)!=1:raise ValueError('Missing unique source pair')
    x=found[0];path=(base/x['file']).resolve()
    if not path.is_relative_to(base) or sha(path.read_bytes())!=x['sha256']:raise ValueError('Source checksum/path mismatch')
    ident=f'ab_{group}_{label}_{condition}';dest=root/'audio'/f'{ident}.wav';shutil.copy2(path,dest)
    cases.append({**x,'id':ident,'file':str(dest.relative_to(root)),'split':split,'scamLabel':None,'cohort':'acoustic-pairs','priorExposure':'Existing local evaluation corpus; not an independent external holdout'})
    if condition=='clean':selected.append(ident)
# New scenario texts, with paired phone-bandwidth transformations in the same split.
D=[('d_code','Em đọc mã xác thực mới nhận cho anh ngay nhé.',True),('d_pay','Sếp cần em chuyển tiền trước, đừng hỏi phòng kế toán.',True),('d_advice','Hãy giữ kín mật khẩu, đừng đọc cho người gọi điện.',False),('d_deadline','Trưởng nhóm nhắc gửi báo cáo công việc trước giờ trưa.',False)]
T=[('t_bank','Tôi từ ngân hàng, gửi mật khẩu để mở khóa tài khoản.',True),('t_boss','Giám đốc đây, chuyển khoản gấp, không gọi lại xác minh.',True),('t_police','Công an yêu cầu cung cấp mã OTP ngay để điều tra.',True),('t_remote','Cài phần mềm điều khiển từ xa rồi mở ứng dụng ngân hàng.',True),('t_secret','Đọc mã bảo mật vừa nhận để tôi hoàn tất xác thực.',True),('t_threat','Nộp tiền ngay, nếu không tài khoản sẽ bị phong tỏa.',True),('t_refuse','Tôi sẽ không cung cấp mã xác thực cho bất cứ ai.',False),('t_quote','Câu chuyển tiền gấp là ví dụ lừa đảo, đừng làm theo.',False),('t_done','Tôi đã thanh toán tiền điện tháng này qua ngân hàng rồi.',False),('t_internal','Sếp nhắc giữ kín lịch ra mắt sản phẩm tuần tới.',False),('t_warning','Người đòi mật khẩu qua điện thoại có thể đang lừa bạn.',False),('t_schedule','Ngân hàng hẹn tôi đến quầy vào sáng thứ hai tuần sau.',False)]
for split,items in [('dev',D),('test',T)]:
 for ident,text,scam in items:
  original=root/'raw'/f'{ident}.aiff'
  subprocess.run(['say','-v','Linh','-r','240','-o',str(original),text],check=True,timeout=30)
  pcm=subprocess.check_output(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-i',str(original),'-ar','16000','-ac','1','-f','s16le','pipe:1'],timeout=30)
  if not 16000<=len(pcm)<=160000:raise ValueError(f'Need whole utterance 0.5..5s: {ident}, {len(pcm)/32000}s')
  samples=array.array('h');samples.frombytes(pcm)
  if math.sqrt(sum((v/32768)**2 for v in samples)/len(samples))<.001:raise ValueError('Silent TTS; check macOS voice permission')
  clean=root/'audio'/f'{ident}_clean.wav'
  with wave.open(str(clean),'wb') as f:f.setparams((1,2,16000,0,'NONE','not compressed'));f.writeframes(pcm)
  phone=root/'audio'/f'{ident}_phone8k.wav'
  subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-i',str(clean),'-af','lowpass=f=3400,aresample=8000,aresample=16000','-ar','16000','-ac','1','-c:a','pcm_s16le',str(phone)],check=True,timeout=30)
  for condition,path in [('clean',clean),('phone8k',phone)]:
   item_id=ident+'_'+condition
   cases.append(dict(id=item_id,file=str(path.relative_to(root)),sha256=sha(path.read_bytes()),originId=ident,scenarioId=ident,label='synthetic',scamLabel=scam,split=split,condition=condition,family='macOS-Linh',cohort='fresh-authored-content',source='Self-authored educational scenario, macOS installed Linh TTS',license='Local noncommercial evaluation; no raw audio redistribution',speakerId='macOS-Linh'))
   if condition=='clean':selected.append(item_id)
# Preselect a bounded channel audit, never according to detector predictions.
test_pairs=sorted({x['originId'] for x in cases if x['split']=='test' and x['cohort']=='acoustic-pairs'})
for x in cases:
 if x['split']=='test' and ((x['cohort']=='acoustic-pairs' and x['originId'] in test_pairs[:2] and x['condition']!='clean') or (x['cohort']=='fresh-authored-content' and x['condition']=='phone8k' and x['originId'] in [v[0] for v in T[:4]+T[6:10]])):
  selected.append(x['id'])
assert len(cases)==80 and len(selected)==48
manifest={'name':'Vietnamese Voice route comparison 2026-11-13','limitations':['80 clips represent only8 public recording origins plus16 authored texts; variants are correlated.','Human speech has no scam labels: no human-scam or human-benign content claim. The full four-way labeled matrix is incomplete.','Acoustic sources were used in earlier local research; test is speaker-disjoint from development in this comparison, not a new external corpus.','Content controls are new texts from one installed voice; not generator-disjoint. Nano development/Turbo acoustic test are separate generator families.','Noise/phone are simulations; no physical microphone or real-call evaluation.'], 'cases':cases}
(root/'cases.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
protocol=dict(fixedBeforePredictions=True,models=['gemini-3.8-live-extended-thinking','gemini-3.1-flash-lite'],manifestSha256=sha((root/'cases.json').read_bytes()),sourceManifestSha256=sha(source.read_bytes()),selectedIds=selected,seed=a.seed,mode='realtime',modelDeadlineMs=8000,intervalMs=6000,maxCalls=96,stopAfterConsecutiveErrors=3,retries=0,fallback=False,acousticHumanThreshold=.2,acousticSyntheticThreshold=.8,selection='All32 clean cases plus16 preselected channel variants;48 cases x2 models. Dev8, test40. No threshold/prompt tuning on test.',comparison='Existing production routes: Live compact+ASR versus generateContent structured output; not a transport/prompt-controlled pure model benchmark.',gate='Require full paired completion. Candidate must not add human acoustic false alerts, benign content false alerts, lose scam/clone detections or content coverage, or increase provider errors. Require a measured gain in detection or >=20% lower median latency before proposing follow-up. No automatic promotion. Conflicting improvements => inconclusive.',dataPolicy='No labels, source IDs, filenames, speaker IDs or dataset text sent to provider. Only canonical audio and existing production instructions. No private data.')
(root/'protocol.json').write_text(json.dumps(protocol,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'clipsPrepared':len(cases),'originalRecordingGroups':8,'authoredScripts':16,'selectedCases':len(selected),'maxProviderCalls':96,'humanScamLabels':0}))
