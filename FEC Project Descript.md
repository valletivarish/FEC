![C:\\Users\\fcarson\\AppData\\Local\\Microsoft\\Windows\\Temporary Internet Files\\Content.Outlook\\JL72I38H\\NCI\_logo\_black\_300dpi (2).jpg][image1]

# **National College of Ireland**

**Master of Science in Cloud Computing, Semester 2, 2026 (MSCCLOUD1JAN26I and MSCCLOUD\_JAN26BI)**

#                      **Fog and Edge Computing (H9FECC)**

# **CA Project Submission Deadline: 27 July 2026 (Tentative)**

# 

**Weight:** The assignment will be marked out of 100\. It is worth 40% of final marks.

**Instructions:** Critically analyse scalable IoT architectures and implement one on a public cloud. You will work individually on this project.

## **SUBMISSION DETAILS**:

A ZIP file/Github Link with the source code and a report in PDF format must be submitted on Moodle before the deadline. The report should be concise, with the main part of the report (including references and appendix), limited to 8 pages in a typical IEEE 2-column format. Include student name, student ID, and course name at the top of the first page. Late submissions will not be penalised if the student applied for an extension through NCI360 and it was approved.

## **DESCRIPTION**:

Create a cloud application solution in line to what has been discussed on the Fog and Edge module. It must integrate and consume sensor data, *either from mock up sensors or consume data from real sensors*. The fog node(s) will be “virtual” (coded) and work together with a cloud backend:

* Sensor & fog layers with the following functionality  
  1. Generate data from 3-5 different sensor types (with configurable frequency & dispatch rates)  
  2. Fog node(s) must receive and process sensor data  
  3. Fog node(s) will then dispatch the payload to the backend

* Backend layer: A *scalable* web service with the following functionality:  
  1. Must process data from the fog node(s) and provide responsive dashboards for the sensor types.  
  2. Must be designed to be scalable (e.g. use queues, FaaS, autoscaling, etc)  
  3. Deployed and tested into a public cloud platform (Azure, AWS, etc)

Note: You can reuse components from your previous projects. Reuse MUST be cited properly.

## **The deliverables should be structured as follows:**

1. A project report (6-8 pages, every additional page will incur a penalty of 10%, formatted using the IEEE Conference double-column template[1](#1-ieee---manuscript-templates-for-conference-proceedings)) which should include:  
   * Abstract – summary of project and main results

   * Introduction – set a domain, objectives & requirements  
   * Architecture and design aspects of your application – critically analyse and justify the selected cloud architecture and design patterns.  
   * Implementation: software components & libraries, continuous integration and deployment of your application (include a link to your GitHub repo)

   * Conclusions including findings/interpretations – what did you learn? Include A short reflection on developing this project.  
   * References – a complete list of academic works and/or online materials used in the project. References should be included as in-text citations using the IEEE referencing style.

2. The source code submission (a ZIP/preferably GitHub Link) should include:  
   * Source code of the applications (including comments)  
   * A readme.txt file that should contain installation instructions.

3. Project presentation and demonstration to be held in class during the submission week as per the CA schedule. It should include the following:  
   * A concise presentation of the motivation and high-level description of the project  
   * Demonstration – show the highlights of your project. What was the most difficult part of the project and how did you solve it  
   * Maximum 4 minutes, every 30 seconds over 4 minutes will incur a penalty of 20%

1 [IEEE \- Manuscript Templates for Conference Proceedings](https://www.ieee.org/conferences/publishing/templates.html)

Important: You must present and demo your project to get marks for this CA. Those who do not show up, will be marked as “Absent” and will therefore receive zero marks.

## **Assessment Criteria**

* Sensor and fog Application – 30%

* Scalable backend Application – 30%  
* Technical report – 20%  
* Presentation & demo – 20%

| Grade Criterion | H1 (\> 70%) | H2.1 (\> 60%) | H2.2 (\> 50%) | Pass (\> 40%) | Fail (\< 40%) |
| :---- | :---- | :---- | :---- | :---- | :---- |
| **Sensors & fog layers (30%)** | The sensors and fog layers have been comprehensively developed, tested, and deployed. Excellent description of the artefacts. | The layers have been developed, tested, and deployed to a high degree. A very good description of the artefacts. | The layers have been developed, tested, and deployed to some degree. A satisfactory description of the artefacts. | The layers were developed, tested, and deployed to a limited extent. Basic description of artefacts. | The layers were not successfully developed, tested, or deployed. Artefacts are poorly described. |
| **Scalable backend layer (30%)** | The scalable backend has been comprehensively developed, tested, and deployed. Excellent description of the artefacts. | The scalable backend has been developed, tested, and deployed to a high degree. A very good description of the artefacts. | The scalable backend has been developed, tested, and deployed to some degree. A satisfactory description of the artefacts. | The scalable backend was developed, tested, and deployed to a limited extent. Basic description of artefacts. | A scalable backend was not successfully developed, tested, or deployed. Artefacts are poorly described. |
| **Technical Report (20%)** | Well written, with no language errors. All figures are well-conceived and easy to read. The report does not exceed the length limits. References are complete, appropriate, and correctly used. | The report has few language and/or style errors. The figures are well presented. Format and length limits are adhered to. References are complete, and correctly used. | The report is readable with some language and/or style errors. Some figures may be hard to read or presented in a suboptimal manner. References are mostly complete and correctly used. | The report is readable, but with many language and/or style errors. Most figures are not clear or easy to read. References are few and/or mostly incomplete. | Littered with typos, and/or poor use of English. The figures are poor and hard to read. References (if any) are probably incomplete and poorly used. |
| **Presentation and demo (20%)** | The presentation and demo clearly outlined the project goals. Slides were error-free and logically presented. The speaker was poised and enthusiastic. Questions were excellently answered. | The presentation and demo somewhat clearly outlined the project goals. Slides were somewhat error-free and somewhat logically presented. The speaker was poised and enthusiastic. Questions were very well answered. | The presentation and demo outlined the project goals. Slides were mostly error-free and mostly logically presented. The speaker was poised and enthusiastic. Questions were well answered. | The presentation and demo provided a limited outline of the project goals. Slides were not error-free and not logically presented. The speaker was poised and enthusiastic. Questions were reasonably well answered. | The presentation and demo were unorganised and unclear. Questions were unanswered/poorly answered. |

Page 4 of 4

[image1]: <data:image/png;base64,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>