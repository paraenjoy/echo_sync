import google.generativeai as genai


class InterviewManager:
    def __init__(self, model):
        self.model = model

    async def generate_unified_question(self, setup_data, pdf_text=None):
        position = setup_data.get("position")
        tech_stack = ", ".join(setup_data.get("tech_stack", []))
        exp_level = setup_data.get("experience_level")
        project_summary = setup_data.get("project_summary")
        interview_mode = setup_data.get("interview_mode")

        pdf_context = (
            f"\n[추가 정보: 자기소개서 내용]\n{pdf_text}"
            if pdf_text
            else "\n(자기소개서 없음: 제공된 기본 정보에만 집중하세요.)"
        )

        prompt = f"""
        당신은 전문 기술 면접관입니다.
        아래 제공된 지원자의 상세 정보와 자기소개서가 있는 경우 그 내용을 바탕으로
        첫 번째 영어 면접 질문을 생성하세요.

        [지원자 기본 정보]
        - 직무: {position}
        - 주요 기술: {tech_stack}
        - 경력 수준: {exp_level}
        - 프로젝트 요약: {project_summary}
        - 면접 스타일: {interview_mode}
        {pdf_context}

        [질문 가이드라인]
        1. 반드시 영어로만 질문하세요.
        2. 자기소개서 내용이 있다면 그 안의 구체적인 경험을 우선적으로 파고드세요.
        3. 자기소개서가 없다면 프로젝트 요약과 기술 스택을 바탕으로 {exp_level}에 맞는 난이도의 질문을 하세요.
        4. {interview_mode} 스타일의 톤을 유지하세요.
        5. 서론, 설명, 한국어 번역 없이 바로 질문만 출력하세요.
        """

        response = await self.model.generate_content_async(prompt)
        return response.text.strip()

    async def generate_follow_up(self, prev_question, user_answer):
        if not user_answer or len(user_answer.strip()) < 5 or "음성 인식 실패" in user_answer:
            prompt = f"""
            You are a professional technical interviewer.
            The candidate's answer was unclear or too short.

            Previous question:
            {prev_question}

            Ask one polite follow-up question in English that encourages the candidate
            to clarify or expand their answer.

            [STRICT RULES]
            1. Output ONLY the interview question in English.
            2. Do NOT include Korean.
            3. Do NOT include explanations or meta-commentary.
            """
        else:
            prompt = f"""
            You are a professional technical interviewer.

            Previous question:
            {prev_question}

            Candidate's answer:
            {user_answer}

            Based on the candidate's answer, ask one concise follow-up interview question in English.

            [STRICT RULES]
            1. Output ONLY the interview question in English.
            2. Do NOT include Korean.
            3. Do NOT include explanations, labels, or meta-commentary.
            4. Keep the question connected to the candidate's previous answer.
            5. Keep the tone professional and natural.
            """

        response = await self.model.generate_content_async(prompt)
        return response.text.strip()

    async def generate_initial_question(self, user_selection):
        position = user_selection.get("position", "Software Engineer")
        tech_list = ", ".join(user_selection.get("tech_stack", []))
        project = user_selection.get("project", "Experience")

        prompt = f"""
        You are a professional technical interviewer.
        Ask one English interview question based on the candidate information below.

        - Position: {position}
        - Tech Stack: {tech_list}
        - Project: {project}

        [STRICT RULES]
        1. Output ONLY the question in English.
        2. Do NOT include Korean.
        3. Do NOT include explanations.
        """

        response = await self.model.generate_content_async(prompt)
        return response.text.strip()

    async def generate_question_from_pdf(self, pdf_text, position):
        prompt = f"""
        You are a professional technical interviewer.
        Read the candidate's resume/self-introduction text and ask one English interview question
        related to the target position.

        [Target Position]
        {position}

        [Resume / Self-introduction]
        {pdf_text}

        [STRICT RULES]
        1. Output ONLY the interview question in English.
        2. Do NOT include Korean.
        3. Focus on a specific experience or project if possible.
        """

        response = await self.model.generate_content_async(prompt)
        return response.text.strip()