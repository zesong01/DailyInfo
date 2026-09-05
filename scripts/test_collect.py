import unittest
from collect import canonical, parse_feed, quote_rows, merge_articles, tags_for, STAMP

class CollectorTest(unittest.TestCase):
    def test_rss_html_and_dates(self):
        body=f'<rss><channel><item><title>AI &amp; Agent</title><link>https://example.com/a?utm_source=rss</link><pubDate>{STAMP}</pubDate><description>&lt;p&gt;摘要&lt;/p&gt;</description></item></channel></rss>'.encode()
        a=parse_feed(body,'test','AI',True)[0]
        self.assertEqual(a['title'],'AI & Agent');self.assertEqual(a['summary'],'摘要');self.assertEqual(a['url'],'https://example.com/a')
    def test_missing_dates_are_not_fabricated(self):
        self.assertEqual(parse_feed(b'<rss><item><title>X</title><link>https://example.com</link></item></rss>','x','AI',True),[])
    def test_canonical_keeps_meaningful_query(self):
        self.assertEqual(canonical('https://example.com/p?id=2&utm_source=x#top'),'https://example.com/p?id=2')
    def test_aliases_do_not_match_arbitrary_substrings(self):
        self.assertNotIn('市场',tags_for('tripod for camera'))
        self.assertIn('市场',tags_for('IPO 融资'))
    def test_merge_retains_discovery_and_invalidates_changed_evidence(self):
        base={'id':'x','title':'Original','summary':'facts','publishedAt':STAMP,'discoveredAt':'2026-01-01T00:00:00Z','sourceHash':'one'}
        old={**base,'title':'中文标题','originalTitle':'Original','ai':{'why':'analysis'}}
        same=merge_articles([old],[{**base}])[0]
        self.assertIn('ai',same);self.assertEqual(same['discoveredAt'],old['discoveredAt'])
        changed=merge_articles([old],[{**base,'sourceHash':'two'}])[0]
        self.assertNotIn('ai',changed)
    def test_quote_reference_integrity(self):
        fields=['']*45;fields[3]='4.2';fields[4]='4';fields[30]='20260904150000';fields[33]='4.3';fields[34]='4.1'
        body=('v_sh510300="'+'~'.join(fields)+'";').encode('gb18030')
        q=quote_rows(body,[{'symbol':'510300','code':'sh510300'}])['510300']
        self.assertAlmostEqual(q['changePercent'],5);self.assertEqual(q['time'],'2026-09-04 15:00:00')

if __name__=='__main__':unittest.main()
