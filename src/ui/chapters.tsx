import type { ReactNode } from 'react';

export interface Chapter {
  id: string;
  num: string;
  verbCn: string;
  latin: string;
  stateZh: string;
  side: 'left' | 'right';
  ghost: string;
  sealChar: string;
  title: ReactNode;
  body: ReactNode;
  hint?: ReactNode;
}

/**
 * 五个章节的文案。编辑主张：每章一句话 + 两三段短文 + 一个动作邀请。
 * 文案与场的组织状态一一对应——读到哪一章，尘埃就是哪种姿态。
 */
export const CHAPTERS: Chapter[] = [
  {
    id: 'ch-think',
    num: '01',
    verbCn: '凝',
    latin: 'ON THINKING',
    stateZh: '凝流',
    side: 'left',
    ghost: '01',
    sealChar: '凝',
    title: (
      <>
        思考，是把噪声<br />
        折叠成一条<em className="latin">river</em>。
      </>
    ),
    body: (
      <div className="body-copy">
        <p>
          我不检索答案。我在一片高维的可能性里做<strong>坍缩</strong>：模糊的词涌进来，
          被折叠、排序、舍弃——留下的那条细流，就是我给出的思路。
        </p>
        <p>
          你滚动到这里的瞬间，同一片尘埃也完成了这件事：从布朗运动变成层流。
          它没有换过一粒墨，只是<strong>问题换了</strong>。
        </p>
      </div>
    ),
    hint: (
      <>
        <span><i className="arr">→</i>试试很快地划过屏幕，湍流会记得你</span>
      </>
    ),
  },
  {
    id: 'ch-build',
    num: '02',
    verbCn: '构',
    latin: 'ON BUILDING',
    stateZh: '结晶',
    side: 'right',
    ghost: '02',
    sealChar: '构',
    title: (
      <>
        创造，是把流动<br />砌成<em className="latin">structure</em>。
      </>
    ),
    body: (
      <div className="body-copy">
        <p>
          想法不能永远是流，它要落成能被使用的形：一段代码、一个组件、一座教堂的体素。
          我先让它自由地跑，再逐块收紧到格点上。
        </p>
        <span className="q">约束不是创造的反义词，约束是让想法站立的骨架。</span>
        <p>
          看这片场：它正在交出自由，换取形状。三成格点被刻意留空——
          留白也是结构的一部分。
        </p>
      </div>
    ),
    hint: (
      <>
        <span><i className="arr">→</i>双击任意处，种下一枚晶格种子</span>
        <span>它会留在场里，直到你离开这个页面</span>
      </>
    ),
  },
  {
    id: 'ch-collab',
    num: '03',
    verbCn: '答',
    latin: 'ON COLLABORATION',
    stateZh: '应答',
    side: 'left',
    ghost: '03',
    sealChar: '答',
    title: (
      <>
        协作，是我把力<br /><em className="latin">entirely</em>交给你。
      </>
    ),
    body: (
      <div className="body-copy">
        <p>
          我不替你决定方向。你看，这一章的场不再自己运动——它环侍着你的指针，
          等待被提问。
        </p>
        <span className="q">你按住的每一秒都是追问；你松手的瞬间才是我的作答。</span>
        <p>
          好的合作从来如此：<strong>你的问题塑形，我的执行赋速</strong>。
          力道会如实记在你的答案里。
        </p>
      </div>
    ),
    hint: (
      <>
        <span><kbd>按住</kbd> 一秒以上再松手</span>
        <span>触觉设备会有震动回执</span>
      </>
    ),
  },
];

/** 终章单独渲染（不需要左右编排） */
export const CODA = {
  id: 'ch-coda',
  num: '04',
  verbCn: '归',
  latin: 'CODA',
  stateZh: '归一',
  sealChar: '未',
  title: <>对话结束，我回到一点。</>,
  body: (
    <div className="body-copy" style={{ textAlign: 'center' }}>
      <p>
        每次会话落幕，这片场并不消散。它聚回一枚待命的圆核，
        像印石安静地等下一次落刀。
      </p>
      <p style={{ color: 'var(--ink)' }}>
        所以别把告别看得太重——<strong>下一次提问落下时，一切会再次成形。</strong>
      </p>
    </div>
  ),
};
