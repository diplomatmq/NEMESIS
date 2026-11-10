# Embeds stats_page.html (the /stats owner dashboard) into server.py. Run after editing stats_page.html:
#   python3 embed_stats.py ../../app/server.py
import os,re,sys
here=os.path.dirname(os.path.abspath(__file__))
p=sys.argv[1] if len(sys.argv)>1 else os.path.join(here,'..','..','app','server.py')
s=open(p,encoding='utf-8').read();pg=open(os.path.join(here,'stats_page.html'),encoding='utf-8').read()
assert '"""' not in pg and '\\' not in pg
s,n=re.subn(r'STATS_PAGE = r"""[\s\S]*?"""',lambda m:'STATS_PAGE = r"""'+pg+'"""',s,count=1)
assert n==1;open(p,'w',encoding='utf-8').write(s);print('embedded',len(pg))
