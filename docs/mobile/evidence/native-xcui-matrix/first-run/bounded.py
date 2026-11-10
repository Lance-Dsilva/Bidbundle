import subprocess,sys,os,signal,time,json
seconds=int(sys.argv[1]); logfile=sys.argv[2]; command=sys.argv[3:]; start=time.time(); mono=time.monotonic()
with open(logfile,'w') as out:
 p=subprocess.Popen(command,stdout=out,stderr=subprocess.STDOUT,start_new_session=True)
 try: code=p.wait(timeout=seconds); timed=False
 except subprocess.TimeoutExpired:
  timed=True; os.killpg(p.pid,signal.SIGTERM)
  try: code=p.wait(timeout=5)
  except subprocess.TimeoutExpired: os.killpg(p.pid,signal.SIGKILL);code=p.wait()
result={'command':command,'exitCode':code,'timedOut':timed,'wallElapsedSeconds':round(time.time()-start,2),'monotonicElapsedSeconds':round(time.monotonic()-mono,2)}
open(logfile+'.result.json','w').write(json.dumps(result,indent=2)+'\n')
print(json.dumps(result));sys.exit(124 if timed else code)
