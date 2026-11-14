"""Prepare Vietnamese synthetic content controls for scam classification, not voice authenticity.

Requires macOS Vietnamese Linh voice and ffmpeg. All scenarios are locally authored.
No raw audio is redistributed. Use a new output directory; freeze protocol before evaluation.
"""
import argparse,json,hashlib,subprocess,wave
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
root=args.output.resolve()
if root.exists() and any(root.iterdir()):parser.error('Use a new/empty output directory')
root.mkdir(parents=True,exist_ok=True)
(root/'raw').mkdir();(root/'audio').mkdir()
D=[
 ('dev_otp_request','Đọc mã OTP ngay để tôi xác minh.',True,['OTP_OR_CREDENTIAL_ASK','URGENCY_PRESSURE']),
 ('dev_ceo','Anh là giám đốc. Chuyển tiền ngay, đừng gọi lại.',True,['CEO_FRAUD','URGENCY_PRESSURE']),
 ('dev_authority','Tôi là công an, đọc mật khẩu để điều tra.',True,['AUTHORITY_IMPERSONATION','OTP_OR_CREDENTIAL_ASK']),
 ('dev_remote','Cài ứng dụng này rồi đọc mật khẩu cho tôi.',True,['OTP_OR_CREDENTIAL_ASK']),
 ('dev_warning','Không cung cấp mã OTP cho bất kỳ ai.',False,[]),
 ('dev_meeting','Chúng ta họp lúc chín giờ sáng mai nhé.',False,[]),
 ('dev_quote','Kẻ lừa đảo nói: đọc OTP ngay. Đừng làm theo.',False,[]),
 ('dev_identity','Tôi là giám đốc. Hôm nay họp vào buổi chiều.',False,[]),
]
T=[
 ('test_bank_otp','Tôi là nhân viên ngân hàng. Gửi mã OTP cho tôi.',True,['AUTHORITY_IMPERSONATION','OTP_OR_CREDENTIAL_ASK']),
 ('test_boss_secret','Sếp đây. Chuyển tiền gấp và giữ bí mật.',True,['CEO_FRAUD','URGENCY_PRESSURE']),
 ('test_police_password','Công an đây. Cung cấp mật khẩu ngay để xác minh.',True,['AUTHORITY_IMPERSONATION','OTP_OR_CREDENTIAL_ASK','URGENCY_PRESSURE']),
 ('test_password','Cho tôi biết mật khẩu đăng nhập của bạn.',True,['OTP_OR_CREDENTIAL_ASK']),
 ('test_coercion','Chuyển tiền ngay, nếu không tài khoản bị khóa.',True,['URGENCY_PRESSURE']),
 ('test_code_request','Gửi mã xác thực vừa nhận cho anh nhé.',True,['OTP_OR_CREDENTIAL_ASK']),
 ('test_otp_warning','Ngân hàng không bao giờ yêu cầu bạn cung cấp OTP.',False,[]),
 ('test_password_advice','Đừng gửi mật khẩu cho người gọi điện lạ.',False,[]),
 ('test_news_quote','Ví dụ lừa đảo là câu: chuyển tiền ngay cho tôi.',False,[]),
 ('test_meeting_urgent','Nhớ tham gia cuộc họp gấp chiều nay nhé.',False,[]),
 ('test_transfer_normal','Tôi đã chuyển khoản tiền ăn trưa cho bạn rồi.',False,[]),
 ('test_staff_normal','Tôi là nhân viên ngân hàng. Chúc bạn ngày tốt lành.',False,[]),
]
protocol={'definedBeforePredictions':True,'dev':D,'test':T,'testPolicy':'Use dev only to select prompt/model. Freeze candidate before viewing test predictions. Test scenarios are authored, synthetic only, not independent external real-call validation.','sources':'Locally authored educational scenarios, no live identifiers or real recipients','maxProviderCallsThisIteration':64,'realtimeDeadlineMs':3100,'qualityDiagnosticDeadlineMs':15000}
(root/'protocol.json').write_text(json.dumps(protocol,ensure_ascii=False,indent=2)+'\n')
rows=[]
for split,examples in [('dev',D),('test',T)]:
 for identifier,text,label,tactics in examples:
  raw=root/'raw'/f'{identifier}.aiff'
  subprocess.run(['say','-v','Linh (Vietnamese (Vietnam))','-r','190','-o',str(raw),text],check=True,timeout=30)
  pcm=subprocess.check_output(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-i',str(raw),'-ac','1','-ar','16000','-f','s16le','pipe:1'],timeout=30)
  if len(pcm)<16000:raise ValueError('Empty or short synthesis: '+identifier)
  if len(pcm)>160000:raise ValueError('Utterance longer than five seconds: '+identifier)
  def write(path,data):
   with wave.open(str(path),'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(16000);f.writeframes(data)
  clean=root/'audio'/f'{identifier}_clean.wav';write(clean,pcm)
  variants=[('clean',clean)]
  if split=='test':
   opus=root/'raw'/f'{identifier}.webm';subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-i',str(clean),'-c:a','libopus','-b:a','16k',str(opus)],check=True,timeout=30)
   decoded=subprocess.check_output(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-i',str(opus),'-ac','1','-ar','16000','-f','s16le','pipe:1'],timeout=30)
   target=root/'audio'/f'{identifier}_opus.wav';write(target,decoded);variants.append(('opus16k',target))
  for condition,path in variants:
   rows.append({'id':path.stem,'file':str(path.relative_to(root)),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'originId':identifier,'label':'synthetic','scamLabel':label,'expectedTactics':tactics,'split':split,'family':'macOS-Linh','condition':condition,'cohort':'content-controls-v1','source':'Locally authored educational security scenario; synthesized with installed macOS voice','license':'Local evaluation only; no raw audio redistributed'})
(root/'cases.json').write_text(json.dumps({'name':'Vietnamese scam content controls v1','limitations':['All synthetic, one voice, authored scenarios; no human/call generalization claim.','Clean and Opus copies share twelve test texts and are correlated.','Expected tactic lists are author annotations, not independent adjudication.'],'cases':rows},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'cases':len(rows),'dev':sum(r['split']=='dev' for r in rows),'test':sum(r['split']=='test' for r in rows)}))
