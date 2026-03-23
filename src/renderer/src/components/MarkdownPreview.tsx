import Markdown from 'react-markdown'

interface Props {
  content: string
}

function MarkdownPreview({ content }: Props): React.JSX.Element {
  return (
    <div className="markdown-preview">
      <Markdown>{content}</Markdown>
    </div>
  )
}

export default MarkdownPreview
