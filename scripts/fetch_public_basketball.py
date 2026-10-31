"""Bounded range-read a public ZIP; download only basketball metadata/sample frames.
No source annotation is promoted to human-confirmed or training-ready.
"""
import io,json,zipfile,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
URL='https://zenodo.org/records/21303900/files/UVY.zip?download=1'
class RemoteZip(io.RawIOBase):
 def __init__(self,url):
  self.url=url;self.position=0;self.transferred=0
  req=urllib.request.Request(url,headers={'Range':'bytes=0-0'})
  with urllib.request.urlopen(req,timeout=40) as response:
   if response.status!=206:raise RuntimeError('Server does not support bounded range reads; full archive download not attempted')
   self.size=int(response.headers['Content-Range'].split('/')[-1]);response.read(1)
 def seekable(self):return True
 def readable(self):return True
 def tell(self):return self.position
 def seek(self,offset,whence=0):
  self.position=offset if whence==0 else self.position+offset if whence==1 else self.size+offset
  return self.position
 def read(self,size=-1):
  if size<0:size=self.size-self.position
  size=min(size,self.size-self.position)
  if size<=0:return b''
  if size>20*1024*1024 or self.transferred+size>100*1024*1024:raise RuntimeError('Download budget exceeded')
  req=urllib.request.Request(self.url,headers={'Range':f'bytes={self.position}-{self.position+size-1}'})
  with urllib.request.urlopen(req,timeout=40) as response:
   if response.status!=206:raise RuntimeError('Range response required')
   data=response.read(size+1)
   if len(data)!=size:raise RuntimeError('Unexpected range length')
  self.position+=len(data);self.transferred+=len(data);return data
if __name__=='__main__':
 out=ROOT/'data/public-sources/uvy';out.mkdir(parents=True,exist_ok=True)
 remote=RemoteZip(URL)
 with zipfile.ZipFile(remote) as archive:
  members=[i for i in archive.infolist() if 'basketball' in i.filename.lower() and not i.is_dir()]
  (out/'remote-index.json').write_text(json.dumps([{'name':i.filename,'bytes':i.file_size} for i in members],indent=2))
  print('Basketball members:',len(members),flush=True)
  metadata=[i for i in members if i.filename.lower().endswith(('.txt','.json','.ini','.csv','.xml')) and i.file_size<5*1024*1024]
  selected=list(metadata)
  for group in ['basketball_V01','basketball_V02','basketball_V03','basketball_V04']:
   images=sorted([i for i in members if group.lower() in i.filename.lower() and i.filename.lower().endswith(('.jpg','.png'))],key=lambda i:i.filename)
   if images:
    selected += [images[round((len(images)-1)*k/4)] for k in range(5)]
  manifest=[]
  for index,item in enumerate(selected):
   # Keep remote path as metadata only. Never extract archive paths into filesystem.
   target=out/(f'{index:03d}-'+Path(item.filename).name)
   data=archive.read(item);target.write_bytes(data)
   manifest.append({'remote_path':item.filename,'local_path':str(target.relative_to(ROOT)),'bytes':len(data),'review_status':'external_unverified'})
   (out/'downloaded.json').write_text(json.dumps(manifest,indent=2));print(item.filename,flush=True)
 print('Transferred bytes',remote.transferred)
