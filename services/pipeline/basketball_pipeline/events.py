"""Experimental rim-crossing candidates, independently implemented.
A crossing is evidence for review, never sufficient proof of a shot or a make.
"""
def rim_crossing_candidates(frames, max_gap=.6, cooldown=1.5):
    previous=None;last_event=-float('inf');events=[]
    for frame in frames:
        t=frame['source_seconds'];ball=frame.get('tentative_link')
        hoops=[e for e in frame.get('entities',[]) if e['class']=='hoop']
        if not ball or not hoops:
            previous=None;continue
        x1,y1,x2,y2=ball['xyxy'];bx=(x1+x2)/2;by=(y1+y2)/2
        hoop=min(hoops,key=lambda h:abs((h['xyxy'][0]+h['xyxy'][2])/2-bx))
        a,b,c,d=hoop['xyxy'];w=c-a;h=d-b
        if w<=0 or h<=0:previous=None;continue
        x=(bx-(a+c)/2)/w;y=(by-b)/h
        current={'time':t,'x':x,'y':y,'segment':ball['segment'],'hoop':hoop['xyxy']}
        if previous and 0<t-previous['time']<=max_gap and previous['segment']==current['segment']:
            pa,pb,pc,pd=previous['hoop']
            stable=abs((a+c-pa-pc)/2)<w and abs(b-pb)<h
            if stable and abs(x)<1 and abs(previous['x'])<1 and previous['y']<0<=y and y<2 and t-last_event>=cooldown:
                events.append({'id':f'rim-{len(events)+1}','kind':'rim_crossing_candidate','start_seconds':previous['time'],'end_seconds':t,'outcome':'unknown','status':'needs_review','evidence':'observed candidates crossed hoop top; not verified shot or score'})
                last_event=t
        previous=current
    return events
